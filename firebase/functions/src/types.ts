// Hand-written TypeScript mirror of the Kotlin data contract in
// core/src/commonMain/kotlin/app/depressify/core/model/Models.kt.
// test/contract.test.ts compares this file with test/fixtures/contract.json, which core's JVM
// tests export from Kotlin. The dashboard's copy is firebase/hosting/js/lib/contract.js.
//
// Rules that hold for every document (see docs/firestore-schema.md):
// - Timestamps are epoch milliseconds in fields ending `AtMillis`.
// - Dates are `yyyy-MM-dd` strings in the device time zone (Europe/Helsinki in the demo).
// - Enumerations are stored as lower-case words.
// - A missing value is null, never zero, and nulls are written explicitly: every field is present.
// - Documents in daily, checkIns, summaries, suggestions, flags and digests carry
//   `sharedWithClinician`: whether the Patient was sharing when the document was created
//   (`sharingStamp` in src/sharing.ts). It never changes; the Clinician reads only those stamped true.

// ---------------------------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------------------------

export const SIGNAL_DIRECTIONS = ["higher_is_better", "lower_is_better", "none"] as const;
export type SignalDirection = (typeof SIGNAL_DIRECTIONS)[number];

/** Signals and their directions. Signals with direction "none" stay out of the composite. */
export const SIGNALS = [
  { key: "sleepMinutes", direction: "higher_is_better" },
  { key: "steps", direction: "higher_is_better" },
  { key: "meanHeartRate", direction: "none" },
  { key: "restingHeartRate", direction: "lower_is_better" },
  { key: "hrv", direction: "higher_is_better" },
  { key: "timeAtHomeMinutes", direction: "lower_is_better" },
  { key: "movementRadiusKm", direction: "higher_is_better" },
  { key: "calendarBusyMinutes", direction: "none" },
  { key: "lateNightScreenMinutes", direction: "lower_is_better" },
] as const satisfies readonly { key: string; direction: SignalDirection }[];
export type SignalKey = (typeof SIGNALS)[number]["key"];

export const FLAG_LEVELS = ["green", "amber", "red"] as const;
export type FlagLevel = (typeof FLAG_LEVELS)[number];

export const FLAG_KINDS = [
  "drift",
  "low_mood",
  "poor_sleep",
  "decline",
  "unassessed",
  "sleep_collapse",
  "inactive",
  "silent",
  "crisis",
] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];

export const SUGGESTION_KINDS = [
  "walk",
  "nature",
  "music",
  "social_call",
  "breathing",
  "class_activity",
  "daylight",
] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export const SUGGESTION_STATUSES = ["proposed", "accepted", "declined"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const HEALTH_SOURCES = ["device", "synthetic"] as const;
export type HealthSource = (typeof HEALTH_SOURCES)[number];

export const SHARING_CONSENTS = ["undecided", "granted", "declined"] as const;
export type SharingConsent = (typeof SHARING_CONSENTS)[number];

/** Consents not about a single Signal. A Consent document id is a SignalKey or one of these. */
export const CONSENT_PURPOSES = ["sharing", "ratings", "voice_cues"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const QUESTIONNAIRE_KINDS = ["phq2", "phq9"] as const;
export type QuestionnaireKind = (typeof QUESTIONNAIRE_KINDS)[number];

/**
 * How Finish Check-in's automatic review (the Decisions API, #20) of a Check-in went. For the
 * Clinician's dashboard only; the Patient app never shows it.
 * - `assessed`: the questions were answered (any flag they gave is in `flags`);
 * - `unassessed`: the safety filter refused to judge it (an amber `unassessed` flag was raised);
 * - `unavailable`: a timeout or other failure. No flag came from it, and the dashboard shows
 *   "assessment unavailable" beside the last known flag, never a new green.
 */
export const ASSESSMENTS = ["assessed", "unassessed", "unavailable"] as const;
export type Assessment = (typeof ASSESSMENTS)[number];

// ---------------------------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------------------------

export const COLLECTIONS = {
  patients: "patients",
  daily: "daily",
  consents: "consents",
  checkIns: "checkIns",
  summaries: "summaries",
  suggestions: "suggestions",
  flags: "flags",
  visits: "visits",
  digests: "digests",
  mail: "mail",
} as const;

export const PATIENT_SUBCOLLECTIONS = [
  COLLECTIONS.daily,
  COLLECTIONS.consents,
  COLLECTIONS.checkIns,
  COLLECTIONS.summaries,
  COLLECTIONS.suggestions,
  COLLECTIONS.flags,
  COLLECTIONS.visits,
  COLLECTIONS.digests,
] as const;

/**
 * The collections whose documents carry `sharedWithClinician` (see `sharingStamp` in sharing.ts).
 * Consents, Visits and the Patient record are not stamped.
 */
export const STAMPED_COLLECTIONS = [
  COLLECTIONS.daily,
  COLLECTIONS.checkIns,
  COLLECTIONS.summaries,
  COLLECTIONS.suggestions,
  COLLECTIONS.flags,
  COLLECTIONS.digests,
] as const;

// ---------------------------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------------------------

/** `patients/{patientId}`. The Patient id is the Patient's auth uid. */
export interface PatientDoc {
  displayName: string;
  clinicianEmail: string;
  intakeHighlights: string;
  /** yyyy-MM-dd */
  tmsEndDate: string | null;
  /** The highest uncleared flag stamped `sharedWithClinician`, or green. */
  flagLevel: FlagLevel;
  /** Those flags' reasons, highest level first, then newest. */
  flagReasons: string[];
  /** Hour of day 0..23. Default 21. */
  quietHoursStart: number;
  /** Hour of day 0..23. Default 9. */
  quietHoursEnd: number;
  /** Last sign of life from the phone. */
  lastSeenAtMillis: number | null;
  lastCheckInAtMillis: number | null;
  healthSource: HealthSource;
  synthetic: boolean;
  sharingConsent: SharingConsent;
  sharingChangedAtMillis: number | null;
}

/** `patients/{id}/daily/{date}`. `values` and `vsBaseline` hold every SignalKey, null where missing. */
export interface DailyDoc {
  date: string;
  values: Partial<Record<SignalKey, number | null>>;
  vsBaseline: Partial<Record<SignalKey, number | null>>;
  composite: number | null;
  demoOverride: boolean;
  /** Whether the Patient was sharing when this record was created. Never changes. */
  sharedWithClinician: boolean;
}

/** `patients/{id}/consents/{subject}`; subject is a SignalKey or a ConsentPurpose. */
export interface Consent {
  subject: SignalKey | ConsentPurpose;
  granted: boolean;
  changedAtMillis: number;
}

export interface VoiceCue {
  label: string;
  /** 1 to 5. */
  intensity: number;
  heard: string;
}

/**
 * `patients/{id}/checkIns/{checkInId}`. Ratings are integers 1 to 5, or null. The app owns only the
 * times; the ratings, Voice cues, crisis marker, assessment and `previousTried` are written by
 * Finish Check-in.
 */
export interface CheckIn {
  id: string;
  startedAtMillis: number;
  endedAtMillis: number | null;
  mood: number | null;
  energy: number | null;
  sleepQuality: number | null;
  voiceCues: VoiceCue[];
  crisis: boolean;
  /**
   * How the automatic review went (`ASSESSMENTS`), written by Finish Check-in. Null until then, and
   * for a Check-in in which the Patient said nothing (there was nothing to review).
   */
  assessment: Assessment | null;
  /**
   * Whether the Patient tried the previous Suggestion, as the automatic review heard it: true, false,
   * or null when unknown (not discussed, unclear, no previous Suggestion, or no review). Written by
   * Finish Check-in; the Outcome on the Suggestion (#21) is written from it.
   */
  previousTried: boolean | null;
  /** Whether the Patient was sharing when this Check-in was created. Never changes. */
  sharedWithClinician: boolean;
}

/** `patients/{id}/summaries/{checkInId}`. Keyed by the Check-in id, so a retried finish overwrites. */
export interface Summary {
  checkInId: string;
  createdAtMillis: number;
  mood: number | null;
  energy: number | null;
  sleepQuality: number | null;
  sleepLine: string;
  themes: string[];
  voiceCues: VoiceCue[];
  suggestion: string | null;
  previousOutcome: string | null;
  /** At most three, each at most 200 characters. */
  quotes: string[];
  /** Whether the Patient was sharing when this Summary was created. Never changes. */
  sharedWithClinician: boolean;
}

/**
 * `patients/{id}/suggestions/{suggestionId}`. The app changes only `status` and `booked`; the Outcome
 * (`tried`, `felt`, `objectiveChange`, `outcomeScore`) is written by functions only.
 */
export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  details: string;
  suggestedAtMillis: number;
  status: SuggestionStatus;
  booked: boolean;
  /** Null until the Patient answers; false means "not this time". */
  tried: boolean | null;
  /** 1 to 5. */
  felt: number | null;
  objectiveChange: number | null;
  outcomeScore: number | null;
  /** Whether the Patient was sharing when this Suggestion was created. Never changes. */
  sharedWithClinician: boolean;
}

/** `patients/{id}/flags/{flagId}`. The reason is a plain sentence, never a score. */
export interface Flag {
  level: FlagLevel;
  kind: FlagKind;
  reason: string;
  raisedAtMillis: number;
  clearedAtMillis: number | null;
  /** Whether the Patient was sharing when this flag was raised. Never changes; false never counts toward `flagLevel`. */
  sharedWithClinician: boolean;
}

/** `patients/{id}/visits/{visitId}`. Written by the Clinician. */
export interface Visit {
  date: string;
  questionnaire: QuestionnaireKind | null;
  /** PHQ-2: 0 to 6; PHQ-9: 0 to 27. */
  score: number | null;
}

/**
 * `patients/{id}/digests/{isoWeek}`, for example `2026-W46`. Written by functions only: the weekly
 * job covers the whole previous week, "Generate now" the current week so far.
 */
export interface Digest {
  isoWeek: string;
  /** First date covered (the Monday), yyyy-MM-dd in Europe/Helsinki. */
  weekStart: string;
  /** Last date covered: the Sunday, or the day "Generate now" ran. */
  weekEnd: string;
  /** How many Summaries the text drew on. 0 means the week had no Check-ins. */
  summaryCount: number;
  text: string;
  generatedAtMillis: number;
  /** Whether the Patient was sharing when this Digest was written (`sharingStamp`). */
  sharedWithClinician: boolean;
}

export interface MailMessage {
  subject: string;
  text: string;
}

/** Top-level `mail/{mailId}`, one per red flag (`mailIdFor` in alerts.ts). Written by functions only (`redFlagAlert`); read by the Trigger Email extension. */
export interface MailDoc {
  to: string;
  message: MailMessage;
}

/** A new Patient record with the same defaults as Kotlin's PatientDoc, nulls written explicitly. */
export function newPatientDoc(displayName: string, clinicianEmail: string): PatientDoc {
  return {
    displayName,
    clinicianEmail,
    intakeHighlights: "",
    tmsEndDate: null,
    flagLevel: "green",
    flagReasons: [],
    quietHoursStart: 21,
    quietHoursEnd: 9,
    lastSeenAtMillis: null,
    lastCheckInAtMillis: null,
    healthSource: "device",
    synthetic: false,
    sharingConsent: "undecided",
    sharingChangedAtMillis: null,
  };
}
