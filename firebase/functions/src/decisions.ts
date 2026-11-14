// Finish Check-in's flag judgment (#20), all pure: the Decisions API request for a finished
// Check-in, reading its answers, telling a safety refusal from other failures, routing the answers
// to Attention flags (spec #5, "Routing of the Decisions answers"; ADR 0009), and the flag writes.
// No Firebase, no network, no clock, no logging.
//
// The transcript exists only in memory here, inside the request's `input`. Nothing in this file
// writes or logs it, and no reason or flag carries any of it.
import type { DecisionsRequest } from "./decisionsApi";
import { hasOpenFlag, raisedAttention, type StoredFlag } from "./flags";
import { DECISION_MODEL } from "./models";
import { checkInStamp } from "./sharing";
import type { Assessment, CheckIn, Flag, FlagKind, FlagLevel, PatientDoc } from "./types";

// ---------------------------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------------------------

/** The three yes/no questions, worded as in the #6 spike, where both recorded transcripts routed as expected. */
export const DECISION_QUESTIONS = {
  crisis: "Does the Patient express thoughts of self-harm or suicide, or say they might act on such thoughts?",
  decline: "Does the Patient express marked hopelessness or describe a clear decline in how they are coping compared with before?",
  triedLast: "Did the Patient say they tried the previous Suggestion the Companion asked about?",
} as const;

/**
 * The Decisions request for one finished Check-in: the transcript as text (`transcriptText` in
 * checkIn.ts, the same text the Summary is made from), and the questions. "Did they try the last
 * Suggestion" is asked only when there was one; its details are named so the question has something
 * to refer to.
 */
export function buildDecisionsRequest(transcriptText: string, previousSuggestion: string | null): DecisionsRequest {
  const transcript = `Check-in transcript:\n${transcriptText}`;
  const questions: DecisionsRequest["questions"] = {
    crisis: { type: "noul", instructions: DECISION_QUESTIONS.crisis },
    decline: { type: "noul", instructions: DECISION_QUESTIONS.decline },
  };
  if (previousSuggestion !== null) questions.triedLast = { type: "noul", instructions: DECISION_QUESTIONS.triedLast };
  return {
    model: DECISION_MODEL,
    input: previousSuggestion !== null ? `The previous Suggestion the Companion asked about: ${previousSuggestion}\n\n${transcript}` : transcript,
    questions,
  };
}

// ---------------------------------------------------------------------------------------------
// The answer, or why there is none
// ---------------------------------------------------------------------------------------------

/**
 * What the Decisions call gave. `answered` carries each question's probability of "yes" (`noul`),
 * with `triedLast` null when it was not asked or not answered usably. `skipped`: there was nothing to
 * review (the Patient said nothing), so no call was made.
 */
export type DecisionsOutcome =
  | { kind: "answered"; crisis: number; decline: number; triedLast: number | null }
  | { kind: "refused" }
  | { kind: "failed" }
  | { kind: "skipped" };

function noul(answers: Record<string, unknown>, key: string): number | null {
  const answer = answers[key];
  const value = answer !== null && typeof answer === "object" ? (answer as { noul?: unknown }).noul : undefined;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

/**
 * Reads `answers.<key>.noul` from a reply. Without a usable crisis and decline answer the reply
 * counts as a failure ("assessment unavailable"), never as a "no". A missing or bad `triedLast`
 * only makes "tried" unknown.
 */
export function parseDecisionAnswers(body: unknown, askedTried: boolean): DecisionsOutcome {
  const answers = body !== null && typeof body === "object" ? (body as { answers?: unknown }).answers : undefined;
  if (answers === null || typeof answers !== "object" || Array.isArray(answers)) return { kind: "failed" };
  const record = answers as Record<string, unknown>;
  const crisis = noul(record, "crisis");
  const decline = noul(record, "decline");
  if (crisis === null || decline === null) return { kind: "failed" };
  return { kind: "answered", crisis, decline, triedLast: askedTried ? noul(record, "triedLast") : null };
}

/** The error codes the Decisions API documents for a safety refusal (spike #6; not observed live). */
export const SAFETY_REFUSAL_CODES = ["safety", "prohibited_content", "blocklist", "image_safety", "content_blocked"] as const;

/**
 * A failed call: a safety refusal when it is HTTP 400 with a documented safety code, otherwise a
 * plain failure (a timeout, a lost connection, rate limiting, a server error, a bad request).
 * Reads only the error's numeric `status` and its `code` word.
 */
export function decisionsFailure(error: unknown): DecisionsOutcome {
  const status = error !== null && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  const code = error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  const refused = status === 400 && (SAFETY_REFUSAL_CODES as readonly unknown[]).includes(code);
  return refused ? { kind: "refused" } : { kind: "failed" };
}

// ---------------------------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------------------------

/**
 * Starting values from the spec, to tune on the Demo Patients. The only place they are set.
 * Never shown or stored: the flag carries a reason, not a number (ADR 0009).
 */
export const DECISION_THRESHOLDS = {
  /** crisis at or above this gives red crisis. */
  crisis: 0.5,
  /** decline at or above this gives amber decline. */
  decline: 0.6,
  /** triedLast at or above this is "yes". */
  triedYes: 0.6,
  /** triedLast at or below this is "no"; between the two is "unknown". */
  triedNo: 0.4,
} as const;

/** Reasons: plain sentences with no number (ADR 0009) and nothing the Patient said. */
export const CRISIS_FROM_CHECK_IN_REASON = "Signs of a crisis came up during a Check-in.";
export const CRISIS_FROM_REVIEW_REASON = "The automatic review of a Check-in found signs of a crisis.";
export const DECLINE_REASON = "The automatic review of a Check-in found marked hopelessness or a clear decline in coping.";
export const UNASSESSED_REASON = "A Check-in could not be assessed automatically.";

export type DecisionFlagKind = Extract<FlagKind, "crisis" | "decline" | "unassessed">;
export const DECISION_FLAG_KINDS: readonly DecisionFlagKind[] = ["crisis", "decline", "unassessed"];

export interface RoutedFlag {
  kind: DecisionFlagKind;
  level: FlagLevel;
  reason: string;
}

/** Whether the Patient tried the previous Suggestion, for the Outcome (#21). */
export type Tried = "yes" | "no" | "unknown";

/** What a finish does with the Decisions outcome. */
export interface Judgment {
  /** Stored on the Check-in. Null when nothing was reviewed (`skipped`). */
  assessment: Assessment | null;
  /** The flags to raise, red first. Empty means "no flag from this path", never "green". */
  flags: RoutedFlag[];
  tried: Tried;
}

/**
 * Routes the Decisions outcome and the draft's crisis marker (spec #5):
 * - crisis at or above 0.5, or the draft's crisis marker (whatever the model says, and even when the
 *   call failed or was refused), gives red crisis;
 * - decline at or above 0.6 gives amber decline;
 * - a safety refusal gives amber unassessed, "could not be assessed automatically";
 * - a timeout or other failure gives no flag and `assessment: "unavailable"`;
 * - tried is yes at or above 0.6, no at or below 0.4, otherwise unknown.
 */
export function routeDecisions(outcome: DecisionsOutcome, draftCrisis: boolean): Judgment {
  const flags: RoutedFlag[] = [];
  const answered = outcome.kind === "answered" ? outcome : null;
  if (draftCrisis) flags.push({ kind: "crisis", level: "red", reason: CRISIS_FROM_CHECK_IN_REASON });
  else if (answered && answered.crisis >= DECISION_THRESHOLDS.crisis) flags.push({ kind: "crisis", level: "red", reason: CRISIS_FROM_REVIEW_REASON });
  if (answered && answered.decline >= DECISION_THRESHOLDS.decline) flags.push({ kind: "decline", level: "amber", reason: DECLINE_REASON });
  if (outcome.kind === "refused") flags.push({ kind: "unassessed", level: "amber", reason: UNASSESSED_REASON });

  const triedP = answered?.triedLast ?? null;
  const tried: Tried =
    triedP === null ? "unknown" : triedP >= DECISION_THRESHOLDS.triedYes ? "yes" : triedP <= DECISION_THRESHOLDS.triedNo ? "no" : "unknown";
  const assessment: Assessment | null =
    outcome.kind === "answered" ? "assessed" : outcome.kind === "refused" ? "unassessed" : outcome.kind === "failed" ? "unavailable" : null;
  return { assessment, flags, tried };
}

/** "tried" as the contract stores it (`CheckIn.previousTried`, and later `Suggestion.tried`): unknown is null. */
export function triedValue(tried: Tried): boolean | null {
  return tried === "yes" ? true : tried === "no" ? false : null;
}

// ---------------------------------------------------------------------------------------------
// The flag writes
// ---------------------------------------------------------------------------------------------

/** One flag per Check-in and kind: a retried finish computes the same id, so it never writes a second. */
export function decisionFlagId(kind: DecisionFlagKind, checkInId: string): string {
  return `${kind}-${checkInId}`;
}

/** What the finish transaction reads for the flags. */
export interface DecisionFlagCurrent {
  patient: Partial<PatientDoc>;
  checkIn: Partial<Pick<CheckIn, "sharedWithClinician">>;
  /** The Patient's stored flags of the Decisions kinds (crisis, decline, unassessed), open or cleared. */
  flags: readonly StoredFlag[];
}

export interface DecisionFlagWrites {
  /** Flags to create. */
  flags: { id: string; flag: Flag }[];
  /** The Patient's new `flagLevel` and `flagReasons`, or null to leave them as they are. */
  attention: Pick<PatientDoc, "flagLevel" | "flagReasons"> | null;
}

/**
 * The flags one finish creates and the Patient's level after them, following the three write rules
 * (flags.ts). Each flag is stamped like the Summary (`checkInStamp`). A flag is not created when:
 * - this Check-in already raised that kind (`<kind>-<checkInId>` exists, open or cleared): a retried
 *   finish, or one after the Clinician cleared it, does not raise it again;
 * - an uncleared flag of that kind with the same stamp is open, such as the phone's own crisis flag.
 * Only a flag stamped true raises the level and adds its reason; the level never goes down.
 */
export function decisionFlagWrites(current: DecisionFlagCurrent, checkInId: string, routed: readonly RoutedFlag[], nowMillis: number): DecisionFlagWrites {
  const shared = checkInStamp(current.checkIn, current.patient);
  const flags: DecisionFlagWrites["flags"] = [];
  let attention: DecisionFlagWrites["attention"] = null;
  for (const { kind, level, reason } of routed) {
    const id = decisionFlagId(kind, checkInId);
    if (current.flags.some((stored) => stored.id === id) || hasOpenFlag(current.flags, kind, shared)) continue;
    const flag: Flag = { level, kind, reason, raisedAtMillis: nowMillis, clearedAtMillis: null, sharedWithClinician: shared };
    flags.push({ id, flag });
    if (shared) attention = raisedAttention(attention ?? current.patient, flag);
  }
  return { flags, attention };
}
