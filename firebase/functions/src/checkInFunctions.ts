// The Check-in callables, both for the Patient (or anyone signed in on a Demo Patient):
//
//   startCheckIn   {patientId, brief, mode?} -> {checkInId, token, model, endpoint, mode,
//                                                connectByMillis, expiresAtMillis}
//                  Mints a single-use ephemeral Live token locked to LIVE_MODEL, the Brief plus the
//                  fixed safety rules, the tool declarations and both transcriptions, then creates
//                  `checkIns/{checkInId}` with empty function-only fields, stamped with `sharingStamp`.
//                  At most MAX_CHECK_IN_STARTS_PER_HOUR per Patient (limits.ts); past that it answers
//                  `resource-exhausted` without minting.
//   finishCheckIn  {patientId, checkInId, draft, todayLines?, lastSuggestionId?}
//                    -> {checkInId, summary, minimal}
//                  Calls the text model (storage off, structured output) for the Summary and, at
//                  the same time, the Decisions API (#20) with the three yes/no questions. Writes
//                  `summaries/{checkInId}`, the ratings, Voice cues (from the draft), crisis marker,
//                  assessment, `previousTried` and end time on the Check-in, any new flags
//                  (`flags/<kind>-<checkInId>`), `lastCheckInAtMillis` / `lastSeenAtMillis` and
//                  the raised flag level on the Patient, and the Outcome on the previous accepted
//                  Suggestion (#21, `src/outcomes.ts`: once per Suggestion), all in one transaction. A retry overwrites
//                  the same Summary, but one without model output keeps what the model wrote before.
//                  A caller who is not the Patient (the demo shortcut) may finish only a Check-in
//                  they started. A text model timeout or server error answers `unavailable` and
//                  saves nothing but the flags the judgment raised, so the phone can retry while it
//                  still holds the draft. A Decisions failure never blocks the Summary: it raises
//                  nothing and marks the Check-in "assessment unavailable". The response never says
//                  anything about a flag or a level: the Patient never sees one.
//
// The Brief, the token and the draft are never written or logged, including on error paths: every
// failure becomes an HttpsError with fixed wording, and log lines carry ids and an HTTP status only.
// test/checkin-logging.test.ts checks this through the callables' HTTP layer.
import { randomUUID } from "node:crypto";
import { FieldPath, type Firestore, type QueryDocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  buildSummaryRequest,
  finishWrites,
  transcriptText,
  newCheckIn,
  parseFinishRequest,
  parseModelSummary,
  patientSpoke,
  summaryContent,
  type CheckInDraft,
  type FinishCheckInResponse,
  type FinishConsents,
  type FinishContent,
  type ModelSummary,
} from "./checkIn";
import {
  DECISION_FLAG_KINDS,
  buildDecisionsRequest,
  decisionFlagWrites,
  decisionsFailure,
  parseDecisionAnswers,
  routeDecisions,
  type DecisionsOutcome,
  type Judgment,
} from "./decisions";
import type { DecisionsClient } from "./decisionsApi";
import type { StoredFlag } from "./flags";
import { GEMINI_API_KEY, type TextModelClient } from "./gemini";
import { callerOf, requireAuth, safely, statusOf, type IntakeCall } from "./intakeFunctions";
import { PATIENT_LIMITS, storedStarts, withStart, type CheckInStart } from "./limits";
import {
  LIVE_ENDPOINT,
  LIVE_MODEL_RESOURCE,
  LIVE_NEW_SESSION_WINDOW_MS,
  LIVE_TOKEN_LIFETIME_MS,
  buildLiveTokenRequest,
  buildSystemInstruction,
  parseStartRequest,
  type LiveTokenClient,
  type StartCheckInResponse,
} from "./live";
import { outcomeDailyNeeded, outcomeTarget, resolveOutcome, type OutcomePlan, type StoredSuggestion } from "./outcomes";
import { assertActsAsPatient } from "./patientCaller";
import { COLLECTIONS, type CheckIn, type DailyDoc, type Flag, type PatientDoc, type Summary, type Suggestion } from "./types";

/** What the Check-in functions read and write. */
export interface CheckInStore {
  getPatient(patientId: string): Promise<Partial<PatientDoc> | undefined>;
  getCheckIn(patientId: string, checkInId: string): Promise<Partial<CheckIn> | undefined>;
  /** `consents/{subject}.granted`, or null when there is no document (which means included). */
  getConsent(patientId: string, subject: "ratings" | "voice_cues" | "steps"): Promise<boolean | null>;
  getSuggestion(patientId: string, suggestionId: string): Promise<Partial<Suggestion> | undefined>;
  /** The Patient's accepted Suggestions (one equality filter), to find the Outcome's target. */
  getAcceptedSuggestions(patientId: string): Promise<StoredSuggestion[]>;
  /**
   * Records the start in `patientLimits/{patientId}`, in a transaction. Resolves false, writing
   * nothing, when the Patient has reached the hourly cap (`withStart`).
   */
  reserveStart(patientId: string, start: CheckInStart): Promise<boolean>;
  /** The recorded start of this Check-in, if Start Check-in created it recently. */
  getStart(patientId: string, checkInId: string): Promise<CheckInStart | undefined>;
  /** Creates `checkIns/{checkIn.id}`; fails if it exists. */
  createCheckIn(patientId: string, checkIn: CheckIn): Promise<void>;
  /**
   * In one transaction: reads the Patient, the Check-in, any earlier Summary and the Patient's flags
   * of the Decisions kinds and, with an Outcome `plan`, the accepted Suggestions (for
   * `outcomeTarget`) and the daily records `outcomeDailyNeeded` names; applies `finishWrites`, and
   * writes the Summary, the Check-in's fields, the new flags, the Patient's times and level, and the
   * Outcome fields on the target Suggestion. Returns the Summary written.
   */
  writeFinish(patientId: string, checkInId: string, content: FinishContent, judgment: Judgment, nowMillis: number, plan: OutcomePlan | null): Promise<Summary>;
  /**
   * In one transaction: reads the Patient, the Check-in and the Patient's flags of the Decisions
   * kinds, applies `decisionFlagWrites`, and creates the new flags and raises the Patient's level.
   * Nothing else. Used when the Summary cannot be made yet, so a raised flag is not lost.
   * Resolves to the number of flags created.
   */
  writeFlags(patientId: string, checkInId: string, judgment: Judgment, nowMillis: number): Promise<number>;
}

export interface StartCheckInDeps {
  store: CheckInStore;
  liveTokens: LiveTokenClient;
  clock?: () => number;
  newId?: () => string;
}

export interface FinishCheckInDeps {
  store: CheckInStore;
  textModel: TextModelClient;
  decisions: DecisionsClient;
  clock?: () => number;
}

/** The Admin SDK store used in production and in the emulator tests. */
export function adminCheckInStore(db: Firestore): CheckInStore {
  const patientRef = (patientId: string) => db.collection(COLLECTIONS.patients).doc(patientId);
  const checkInRef = (patientId: string, checkInId: string) => patientRef(patientId).collection(COLLECTIONS.checkIns).doc(checkInId);
  const summaryRef = (patientId: string, checkInId: string) => patientRef(patientId).collection(COLLECTIONS.summaries).doc(checkInId);
  const limitsRef = (patientId: string) => db.collection(PATIENT_LIMITS).doc(patientId);
  const flagsRef = (patientId: string) => patientRef(patientId).collection(COLLECTIONS.flags);
  const suggestionsRef = (patientId: string) => patientRef(patientId).collection(COLLECTIONS.suggestions);
  const acceptedQuery = (patientId: string) => suggestionsRef(patientId).where("status", "==", "accepted");
  const storedSuggestions = (docs: QueryDocumentSnapshot[]): StoredSuggestion[] =>
    docs.map((doc) => ({ id: doc.id, suggestion: doc.data() as Partial<Suggestion> }));
  /** Daily records keyed by date, from `start` to `end` inclusive (a range on the document id: no index). */
  const dailyIn = async (tx: Transaction, patientId: string, { start, end }: { start: string; end: string }): Promise<Partial<DailyDoc>[]> =>
    (
      await tx.get(
        patientRef(patientId).collection(COLLECTIONS.daily).where(FieldPath.documentId(), ">=", start).where(FieldPath.documentId(), "<=", end),
      )
    ).docs.map((doc) => ({ ...(doc.data() as Partial<DailyDoc>), date: doc.id }));
  /** The Patient's flags of the kinds the Decisions routing raises, open or cleared (one `in` filter, no composite index). */
  const decisionFlags = async (tx: Transaction, patientId: string): Promise<StoredFlag[]> =>
    (await tx.get(flagsRef(patientId).where("kind", "in", [...DECISION_FLAG_KINDS]))).docs.map((doc) => ({ id: doc.id, flag: doc.data() as Partial<Flag> }));
  return {
    async getPatient(patientId) {
      const snapshot = await patientRef(patientId).get();
      return snapshot.exists ? (snapshot.data() as Partial<PatientDoc>) : undefined;
    },
    async getCheckIn(patientId, checkInId) {
      const snapshot = await checkInRef(patientId, checkInId).get();
      return snapshot.exists ? (snapshot.data() as Partial<CheckIn>) : undefined;
    },
    async getConsent(patientId, subject) {
      const snapshot = await patientRef(patientId).collection(COLLECTIONS.consents).doc(subject).get();
      const granted = snapshot.exists ? snapshot.get("granted") : null;
      return typeof granted === "boolean" ? granted : null;
    },
    async getSuggestion(patientId, suggestionId) {
      const snapshot = await suggestionsRef(patientId).doc(suggestionId).get();
      return snapshot.exists ? (snapshot.data() as Partial<Suggestion>) : undefined;
    },
    async getAcceptedSuggestions(patientId) {
      return storedSuggestions((await acceptedQuery(patientId).get()).docs);
    },
    async reserveStart(patientId, start) {
      return db.runTransaction(async (tx) => {
        const starts = withStart((await tx.get(limitsRef(patientId))).get("checkInStarts"), start);
        if (starts === null) return false;
        tx.set(limitsRef(patientId), { checkInStarts: starts }, { merge: true });
        return true;
      });
    },
    async getStart(patientId, checkInId) {
      const stored = (await limitsRef(patientId).get()).get("checkInStarts");
      return storedStarts(stored).find((start) => start.checkInId === checkInId);
    },
    async createCheckIn(patientId, checkIn) {
      await checkInRef(patientId, checkIn.id).create(checkIn);
    },
    async writeFinish(patientId, checkInId, content, judgment, nowMillis, plan) {
      return db.runTransaction(async (tx) => {
        const [patient, checkIn, summary, flags, accepted] = await Promise.all([
          tx.get(patientRef(patientId)),
          tx.get(checkInRef(patientId, checkInId)),
          tx.get(summaryRef(patientId, checkInId)),
          decisionFlags(tx, patientId),
          plan ? tx.get(acceptedQuery(patientId)).then((q) => storedSuggestions(q.docs)) : Promise.resolve([]),
        ]);
        if (!patient.exists || !checkIn.exists) throw new Error("The Patient or the Check-in is missing.");
        const checkInData = checkIn.data() as Partial<CheckIn>;
        const target = plan ? outcomeTarget(accepted, { id: checkInId, startedAtMillis: checkInData.startedAtMillis }, plan.excludeIds) : undefined;
        const range = outcomeDailyNeeded(target, plan);
        const daily = range ? await dailyIn(tx, patientId, range) : [];
        const writes = finishWrites(
          {
            patient: patient.data() as Partial<PatientDoc>,
            checkIn: checkInData,
            summary: summary.exists ? (summary.data() as Partial<Summary>) : undefined,
            flags,
            outcome: { target, daily },
          },
          checkInId,
          content,
          nowMillis,
          judgment,
          plan,
        );
        tx.set(summaryRef(patientId, checkInId), writes.summary);
        tx.update(checkInRef(patientId, checkInId), writes.checkIn);
        tx.update(patientRef(patientId), writes.patient);
        // create(): a flag id that exists fails the transaction rather than overwrite a flag.
        for (const { id, flag } of writes.flags) tx.create(flagsRef(patientId).doc(id), flag);
        // Only the Outcome fields: the Suggestion's stamp, status and the rest are left as they are.
        if (writes.suggestion) tx.update(suggestionsRef(patientId).doc(writes.suggestion.id), writes.suggestion.fields);
        return writes.summary;
      });
    },
    async writeFlags(patientId, checkInId, judgment, nowMillis) {
      if (judgment.flags.length === 0) return 0;
      return db.runTransaction(async (tx) => {
        const [patient, checkIn, flags] = await Promise.all([
          tx.get(patientRef(patientId)),
          tx.get(checkInRef(patientId, checkInId)),
          decisionFlags(tx, patientId),
        ]);
        if (!patient.exists || !checkIn.exists) throw new Error("The Patient or the Check-in is missing.");
        const writes = decisionFlagWrites(
          { patient: patient.data() as Partial<PatientDoc>, checkIn: checkIn.data() as Partial<CheckIn>, flags },
          checkInId,
          judgment.flags,
          nowMillis,
        );
        for (const { id, flag } of writes.flags) tx.create(flagsRef(patientId).doc(id), flag);
        if (writes.attention) tx.update(patientRef(patientId), writes.attention);
        return writes.flags.length;
      });
    },
  };
}

export async function readOrUnavailable<T>(name: string, ids: Record<string, string>, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch {
    logger.warn(`${name}: a read failed`, ids);
    throw new HttpsError("unavailable", "Could not reach your records. Try again.");
  }
}

/** Mints the Live token and creates the Check-in. */
export async function startCheckInHandler(call: IntakeCall, deps: StartCheckInDeps): Promise<StartCheckInResponse> {
  const auth = requireAuth(call.auth);
  // An empty or oversized Brief stops here, before any read or token request.
  const { patientId, brief, mode } = parseStartRequest(call.data);
  const patient = await readOrUnavailable("startCheckIn", { patientId }, () => deps.store.getPatient(patientId));
  assertActsAsPatient(patientId, patient, auth);

  const nowMillis = (deps.clock ?? Date.now)();
  const checkInId = (deps.newId ?? randomUUID)();
  // Before the token: a refused start costs nothing. A start whose token request then fails still
  // counts, so retries against a failing Gemini are capped too.
  let reserved: boolean;
  try {
    reserved = await deps.store.reserveStart(patientId, { checkInId, uid: auth.uid, startedAtMillis: nowMillis });
  } catch {
    logger.warn("startCheckIn: could not record the start", { patientId });
    throw new HttpsError("unavailable", "Could not start the Check-in. Try again.");
  }
  if (!reserved) {
    logger.warn("startCheckIn: the hourly cap is reached", { patientId });
    throw new HttpsError("resource-exhausted", "Too many Check-ins were started in the last hour. Try again later.");
  }

  const systemInstruction = buildSystemInstruction(brief, { firstCheckIn: patient.lastCheckInAtMillis == null, mode });
  let token: string;
  try {
    token = await deps.liveTokens.createToken(buildLiveTokenRequest({ systemInstruction, nowMillis }));
  } catch (error) {
    // Never log the error itself: it may carry the request.
    logger.warn("startCheckIn: the Live token request failed", { patientId, status: statusOf(error) });
    throw new HttpsError("unavailable", "Could not start the Check-in. Try again.");
  }

  try {
    // Written here rather than by the phone, so the Check-in exists before the phone connects and
    // its function-only fields start empty under the Admin SDK.
    await deps.store.createCheckIn(patientId, newCheckIn(checkInId, patient, nowMillis));
  } catch {
    logger.warn("startCheckIn: could not create the Check-in", { patientId, checkInId });
    throw new HttpsError("unavailable", "Could not start the Check-in. Try again.");
  }

  return {
    checkInId,
    token,
    model: LIVE_MODEL_RESOURCE,
    endpoint: LIVE_ENDPOINT,
    mode,
    connectByMillis: nowMillis + LIVE_NEW_SESSION_WINDOW_MS,
    expiresAtMillis: nowMillis + LIVE_TOKEN_LIFETIME_MS,
  };
}

/** Makes and saves the Summary, then drops the draft. */
export async function finishCheckInHandler(call: IntakeCall, deps: FinishCheckInDeps): Promise<FinishCheckInResponse> {
  const auth = requireAuth(call.auth);
  const { patientId, checkInId, draft, todayLines, lastSuggestionId } = parseFinishRequest(call.data);
  const ids = { patientId, checkInId };
  const patient = await readOrUnavailable("finishCheckIn", ids, () => deps.store.getPatient(patientId));
  assertActsAsPatient(patientId, patient, auth);
  if (auth.uid !== patientId) {
    // The demo shortcut lets anyone signed in act as a Demo Patient. Only the caller who started
    // this Check-in may finish it, so nobody can overwrite the Demo Patient's other Summaries.
    const startedBy = await readOrUnavailable("finishCheckIn", ids, () => deps.store.getStart(patientId, checkInId));
    if (startedBy?.uid !== auth.uid) throw new HttpsError("permission-denied", "Only the phone that started this Check-in can finish it.");
  }

  const [checkIn, ratingsConsent, voiceCuesConsent, stepsConsent, named, accepted] = await readOrUnavailable("finishCheckIn", ids, () =>
    Promise.all([
      deps.store.getCheckIn(patientId, checkInId),
      deps.store.getConsent(patientId, "ratings"),
      deps.store.getConsent(patientId, "voice_cues"),
      deps.store.getConsent(patientId, "steps"),
      lastSuggestionId ? deps.store.getSuggestion(patientId, lastSuggestionId) : Promise.resolve(undefined),
      deps.store.getAcceptedSuggestions(patientId),
    ]),
  );
  if (!checkIn) throw new HttpsError("not-found", "This Check-in was not started.");
  const consents: FinishConsents = { ratings: ratingsConsent !== false, voiceCues: voiceCuesConsent !== false };

  // The Outcome's target (#21) is found here, not taken from the phone: the most recent accepted
  // Suggestion made before this Check-in with no Outcome yet (`outcomeTarget`). When the phone names
  // the Suggestion the Companion asked about, the Outcome is written only if it is that target: an
  // answer about another Suggestion (a declined one, or one already answered) never lands on it.
  const draftIds = draft.suggestions.map((s) => s.id).filter((id): id is string => id !== null);
  const target = outcomeTarget(accepted, { id: checkInId, startedAtMillis: checkIn.startedAtMillis }, draftIds);
  const outcomeAllowed = target !== undefined && (lastSuggestionId === null || lastSuggestionId === target.id);
  if (target !== undefined && !outcomeAllowed) logger.warn("finishCheckIn: the last Suggestion is not the open Outcome; no Outcome is written", ids);
  // What both models are told was asked about: the Suggestion the phone names, else the target.
  const previous = lastSuggestionId ? named : target?.suggestion;

  // A silent Check-in gets the minimal Summary without a model call, and no review: there is
  // nothing to summarise or judge, and nothing can be invented. Its crisis marker still counts.
  // Otherwise the text model and the Decisions API run at the same time on the same in-memory
  // transcript; neither call throws here.
  const spoke = patientSpoke(draft);
  const previousSuggestion = typeof previous?.details === "string" ? previous.details : null;
  const [summarised, outcome] = await Promise.all([
    spoke ? summarise(deps.textModel, draft, todayLines, previousSuggestion, ids) : Promise.resolve({ model: null, retry: false }),
    spoke ? judge(deps.decisions, draft, previousSuggestion, ids) : Promise.resolve<DecisionsOutcome>({ kind: "skipped" }),
  ]);
  const judgment = routeDecisions(outcome, draft.crisis);
  const nowMillis = (deps.clock ?? Date.now)();

  if (summarised.retry) {
    // The Summary waits for the phone's retry, but a flag the judgment raised is written now, so a
    // crisis is not lost if the phone never retries. Its id is fixed per Check-in and kind, so the
    // retry does not raise it again.
    if (judgment.flags.length > 0) {
      try {
        await deps.store.writeFlags(patientId, checkInId, judgment, nowMillis);
      } catch {
        logger.warn("finishCheckIn: could not save the flags before the retry", ids);
      }
    }
    throw new HttpsError("unavailable", "Could not make your Summary. Try again.");
  }
  const model = summarised.model;

  const content = summaryContent(model, draft, consents);
  // The text model's answer first, the Decisions "tried" only when it is unsure (`resolveOutcome`).
  const answer = outcomeAllowed ? resolveOutcome(model, judgment.tried) : null;
  const plan: OutcomePlan | null =
    answer !== null ? { suggestionId: target!.id, answer, stepsAllowed: stepsConsent !== false, excludeIds: draftIds } : null;
  let summary: Summary;
  try {
    summary = await deps.store.writeFinish(patientId, checkInId, content, judgment, nowMillis, plan);
  } catch {
    logger.warn("finishCheckIn: could not save the Summary", ids);
    throw new HttpsError("unavailable", "Could not save your Summary. Try again.");
  }

  // Only the Summary: never the judgment, a flag or a level (the Patient never sees one).
  return { checkInId, summary, minimal: model === null };
}

/**
 * The text model call. `retry` when it failed in a way that may pass (a timeout, a lost connection,
 * rate limiting, a server error): nothing is saved and the phone retries. A reply that is not
 * usable, or a refusal that would fail again the same way, gives `model: null` (the minimal Summary).
 */
async function summarise(
  textModel: TextModelClient,
  draft: CheckInDraft,
  todayLines: readonly string[],
  previousSuggestion: string | null,
  ids: Record<string, string>,
): Promise<{ model: ModelSummary | null; retry: boolean }> {
  const startedAt = Date.now();
  try {
    const model = parseModelSummary(await textModel.generateText(buildSummaryRequest(draft, todayLines, previousSuggestion)));
    if (model === null) logger.warn("finishCheckIn: the text model's reply was not usable; saving a minimal Summary", ids);
    return { model, retry: false };
  } catch (error) {
    // Never log the error itself: its message or body may echo the transcript. Its class name and
    // the time it took tell a timeout from a refusal.
    const status = statusOf(error);
    const mayPass = status === null || status === 408 || status === 429 || status >= 500;
    logger.warn("finishCheckIn: the text model call failed; " + (mayPass ? "nothing saved, the phone can retry" : "saving a minimal Summary"), {
      ...ids,
      status,
      error: error instanceof Error ? error.name : typeof error,
      elapsedMs: Date.now() - startedAt,
    });
    return { model: null, retry: mayPass };
  }
}

/**
 * The Decisions call (#20): the three yes/no questions about the same transcript. Never throws: a
 * safety refusal is `refused`, any other failure (a timeout, an error, an unusable reply) `failed`.
 * Logs only the outcome, the HTTP status and the time it took: never the input or an error body.
 */
async function judge(
  decisions: DecisionsClient,
  draft: CheckInDraft,
  previousSuggestion: string | null,
  ids: Record<string, string>,
): Promise<DecisionsOutcome> {
  const startedAt = Date.now();
  let outcome: DecisionsOutcome;
  let status: number | null = null;
  try {
    outcome = parseDecisionAnswers(await decisions.decide(buildDecisionsRequest(transcriptText(draft.turns), previousSuggestion)), previousSuggestion !== null);
  } catch (error) {
    status = statusOf(error);
    outcome = decisionsFailure(error);
  }
  if (outcome.kind === "refused") {
    logger.warn("finishCheckIn: the Decisions API declined to judge the Check-in; raising amber unassessed", { ...ids, status, elapsedMs: Date.now() - startedAt });
  } else if (outcome.kind === "failed") {
    logger.warn("finishCheckIn: the Decisions call failed; no flag from it, assessment unavailable", { ...ids, status, elapsedMs: Date.now() - startedAt });
  }
  return outcome;
}

/** How the callables get their dependencies, built per request so secrets are read at run time. */
export interface CheckInDepsFactory {
  store: () => CheckInStore;
  textModel: () => TextModelClient;
  decisions: () => DecisionsClient;
  liveTokens: () => LiveTokenClient;
  clock?: () => number;
  newId?: () => string;
}

/** Builds the two callables. Production passes the Admin SDK and Gemini; tests pass fakes. */
export function createCheckInFunctions(deps: CheckInDepsFactory) {
  const startCheckIn = onCall({ secrets: [GEMINI_API_KEY], timeoutSeconds: 30 }, (request) =>
    safely("startCheckIn", () =>
      startCheckInHandler(callerOf(request), {
        store: deps.store(),
        // Built only when the token is minted, after the input and caller checks.
        liveTokens: { createToken: (tokenRequest) => deps.liveTokens().createToken(tokenRequest) },
        clock: deps.clock,
        newId: deps.newId,
      }),
    ),
  );
  const finishCheckIn = onCall({ secrets: [GEMINI_API_KEY], timeoutSeconds: 60 }, (request) =>
    safely("finishCheckIn", () =>
      finishCheckInHandler(callerOf(request), {
        store: deps.store(),
        textModel: { generateText: (textRequest) => deps.textModel().generateText(textRequest) },
        // Built only when called, so a missing key is a Decisions failure, not a failed finish.
        decisions: { decide: (decisionsRequest) => deps.decisions().decide(decisionsRequest) },
        clock: deps.clock,
      }),
    ),
  );
  return { startCheckIn, finishCheckIn };
}
