// The Check-in callables, both for the Patient (or anyone signed in on a Demo Patient):
//
//   startCheckIn   {patientId, brief, mode?} -> {checkInId, token, model, endpoint, mode,
//                                                connectByMillis, expiresAtMillis}
//                  Mints a single-use ephemeral Live token locked to LIVE_MODEL, the Brief plus the
//                  fixed safety rules, the tool declarations and both transcriptions, then creates
//                  `checkIns/{checkInId}` with empty function-only fields, stamped with `sharingStamp`.
//   finishCheckIn  {patientId, checkInId, draft, todayLines?, lastSuggestionId?}
//                    -> {checkInId, summary, minimal}
//                  Calls the text model (storage off, structured output) for the Summary, writes
//                  `summaries/{checkInId}`, the ratings, Voice cues (from the draft), crisis marker and
//                  end time on the Check-in, and `lastCheckInAtMillis` / `lastSeenAtMillis` on the
//                  Patient, all in one transaction. A retry overwrites the same Summary.
//
// The Brief, the token and the draft are never written or logged, including on error paths: every
// failure becomes an HttpsError with fixed wording, and log lines carry ids and an HTTP status only.
// test/checkin-logging.test.ts checks this through the callables' HTTP layer.
import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  buildSummaryRequest,
  finishWrites,
  newCheckIn,
  parseFinishRequest,
  parseModelSummary,
  patientSpoke,
  summaryContent,
  type FinishCheckInResponse,
  type FinishConsents,
  type FinishContent,
  type ModelSummary,
} from "./checkIn";
import { GEMINI_API_KEY, type TextModelClient } from "./gemini";
import { callerOf, requireAuth, safely, statusOf, type IntakeCall } from "./intakeFunctions";
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
import { assertActsAsPatient } from "./patientCaller";
import { COLLECTIONS, type CheckIn, type PatientDoc, type Summary, type Suggestion } from "./types";

/** What the Check-in functions read and write. */
export interface CheckInStore {
  getPatient(patientId: string): Promise<Partial<PatientDoc> | undefined>;
  getCheckIn(patientId: string, checkInId: string): Promise<Partial<CheckIn> | undefined>;
  /** `consents/{subject}.granted`, or null when there is no document (which means included). */
  getConsent(patientId: string, subject: "ratings" | "voice_cues"): Promise<boolean | null>;
  getSuggestion(patientId: string, suggestionId: string): Promise<Partial<Suggestion> | undefined>;
  /** Creates `checkIns/{checkIn.id}`; fails if it exists. */
  createCheckIn(patientId: string, checkIn: CheckIn): Promise<void>;
  /**
   * In one transaction: reads the Patient, the Check-in and any earlier Summary, applies
   * `finishWrites`, and writes the Summary, the Check-in's fields and the Patient's times.
   * Returns the Summary written.
   */
  writeFinish(patientId: string, checkInId: string, content: FinishContent, nowMillis: number): Promise<Summary>;
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
  clock?: () => number;
}

/** The Admin SDK store used in production and in the emulator tests. */
export function adminCheckInStore(db: Firestore): CheckInStore {
  const patientRef = (patientId: string) => db.collection(COLLECTIONS.patients).doc(patientId);
  const checkInRef = (patientId: string, checkInId: string) => patientRef(patientId).collection(COLLECTIONS.checkIns).doc(checkInId);
  const summaryRef = (patientId: string, checkInId: string) => patientRef(patientId).collection(COLLECTIONS.summaries).doc(checkInId);
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
      const snapshot = await patientRef(patientId).collection(COLLECTIONS.suggestions).doc(suggestionId).get();
      return snapshot.exists ? (snapshot.data() as Partial<Suggestion>) : undefined;
    },
    async createCheckIn(patientId, checkIn) {
      await checkInRef(patientId, checkIn.id).create(checkIn);
    },
    async writeFinish(patientId, checkInId, content, nowMillis) {
      return db.runTransaction(async (tx) => {
        const [patient, checkIn, summary] = await Promise.all([
          tx.get(patientRef(patientId)),
          tx.get(checkInRef(patientId, checkInId)),
          tx.get(summaryRef(patientId, checkInId)),
        ]);
        if (!patient.exists || !checkIn.exists) throw new Error("The Patient or the Check-in is missing.");
        const writes = finishWrites(
          {
            patient: patient.data() as Partial<PatientDoc>,
            checkIn: checkIn.data() as Partial<CheckIn>,
            summary: summary.exists ? (summary.data() as Partial<Summary>) : undefined,
          },
          checkInId,
          content,
          nowMillis,
        );
        tx.set(summaryRef(patientId, checkInId), writes.summary);
        tx.update(checkInRef(patientId, checkInId), writes.checkIn);
        tx.update(patientRef(patientId), writes.patient);
        return writes.summary;
      });
    },
  };
}

async function readOrUnavailable<T>(name: string, ids: Record<string, string>, read: () => Promise<T>): Promise<T> {
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
  const systemInstruction = buildSystemInstruction(brief, { firstCheckIn: patient.lastCheckInAtMillis == null, mode });
  let token: string;
  try {
    token = await deps.liveTokens.createToken(buildLiveTokenRequest({ systemInstruction, nowMillis }));
  } catch (error) {
    // Never log the error itself: it may carry the request.
    logger.warn("startCheckIn: the Live token request failed", { patientId, status: statusOf(error) });
    throw new HttpsError("unavailable", "Could not start the Check-in. Try again.");
  }

  const checkInId = (deps.newId ?? randomUUID)();
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

  const [checkIn, ratingsConsent, voiceCuesConsent, previous] = await readOrUnavailable("finishCheckIn", ids, () =>
    Promise.all([
      deps.store.getCheckIn(patientId, checkInId),
      deps.store.getConsent(patientId, "ratings"),
      deps.store.getConsent(patientId, "voice_cues"),
      lastSuggestionId ? deps.store.getSuggestion(patientId, lastSuggestionId) : Promise.resolve(undefined),
    ]),
  );
  if (!checkIn) throw new HttpsError("not-found", "This Check-in was not started.");
  const consents: FinishConsents = { ratings: ratingsConsent !== false, voiceCues: voiceCuesConsent !== false };

  // A silent Check-in gets the minimal Summary without a model call: there is nothing to summarise,
  // and nothing can be invented.
  let model: ModelSummary | null = null;
  if (patientSpoke(draft)) {
    try {
      const previousSuggestion = typeof previous?.details === "string" ? previous.details : null;
      model = parseModelSummary(await deps.textModel.generateText(buildSummaryRequest(draft, todayLines, previousSuggestion)));
      if (model === null) logger.warn("finishCheckIn: the text model's reply was not usable; saving a minimal Summary", ids);
    } catch (error) {
      // Never log the error itself: its message or body may echo the transcript.
      logger.warn("finishCheckIn: the text model call failed; saving a minimal Summary", { ...ids, status: statusOf(error) });
    }
  }

  // TODO(#20): ask the Decisions API (gemini-decision-1) the three yes/no questions (crisis, decline,
  // tried the last Suggestion) here, from the same in-memory transcript, and route the answers to
  // flags and the Patient's level inside `writeFinish`. The draft's crisis marker already sets
  // `crisis` on the Check-in; the red crisis flag itself is raised by the phone.

  const content = summaryContent(model, draft, consents);
  let summary: Summary;
  try {
    summary = await deps.store.writeFinish(patientId, checkInId, content, (deps.clock ?? Date.now)());
  } catch {
    logger.warn("finishCheckIn: could not save the Summary", ids);
    throw new HttpsError("unavailable", "Could not save your Summary. Try again.");
  }

  // TODO(#21): write the Outcome on `suggestions/{lastSuggestionId}` from `model.previousTried` and
  // `model.previousFelt` (and the Decisions answer from #20), then `objectiveChange` and
  // `outcomeScore` from the day's steps against Baseline. `lastSuggestionId` is validated and the
  // Suggestion read above; nothing writes it yet.

  return { checkInId, summary, minimal: model === null };
}

/** How the callables get their dependencies, built per request so secrets are read at run time. */
export interface CheckInDepsFactory {
  store: () => CheckInStore;
  textModel: () => TextModelClient;
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
        clock: deps.clock,
      }),
    ),
  );
  return { startCheckIn, finishCheckIn };
}
