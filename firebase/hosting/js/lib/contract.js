// The dashboard's copy of the data contract. It mirrors firebase/functions/src/types.ts, which
// mirrors the Kotlin contract in core; firebase/functions/test/contract.test.ts checks that all three
// agree. Field-by-field documentation is in docs/firestore-schema.md.

/** @typedef {"higher_is_better" | "lower_is_better" | "none"} SignalDirection */
/** @typedef {"green" | "amber" | "red"} FlagLevel */
/** @typedef {"undecided" | "granted" | "declined"} SharingConsent */
/** @typedef {"device" | "synthetic"} HealthSource */

/**
 * `patients/{patientId}`.
 * @typedef {object} PatientDoc
 * @property {string} displayName
 * @property {string} clinicianEmail
 * @property {string} intakeHighlights
 * @property {string | null} tmsEndDate yyyy-MM-dd
 * @property {FlagLevel} flagLevel
 * @property {string[]} flagReasons
 * @property {number} quietHoursStart
 * @property {number} quietHoursEnd
 * @property {number | null} lastSeenAtMillis
 * @property {number | null} lastCheckInAtMillis
 * @property {HealthSource} healthSource
 * @property {boolean} synthetic
 * @property {SharingConsent} sharingConsent
 * @property {number | null} sharingChangedAtMillis
 */

export const SIGNALS = Object.freeze([
  { key: "sleepMinutes", direction: "higher_is_better" },
  { key: "steps", direction: "higher_is_better" },
  { key: "meanHeartRate", direction: "none" },
  { key: "restingHeartRate", direction: "lower_is_better" },
  { key: "hrv", direction: "higher_is_better" },
  { key: "timeAtHomeMinutes", direction: "lower_is_better" },
  { key: "movementRadiusKm", direction: "higher_is_better" },
  { key: "calendarBusyMinutes", direction: "none" },
  { key: "lateNightScreenMinutes", direction: "lower_is_better" },
]);

export const FLAG_LEVELS = Object.freeze(["green", "amber", "red"]);
export const FLAG_KINDS = Object.freeze([
  "drift",
  "low_mood",
  "poor_sleep",
  "decline",
  "unassessed",
  "sleep_collapse",
  "inactive",
  "silent",
  "crisis",
]);
export const SUGGESTION_KINDS = Object.freeze([
  "walk",
  "nature",
  "music",
  "social_call",
  "breathing",
  "class_activity",
  "daylight",
]);
export const SUGGESTION_STATUSES = Object.freeze(["proposed", "accepted", "declined"]);
export const HEALTH_SOURCES = Object.freeze(["device", "synthetic"]);
export const SHARING_CONSENTS = Object.freeze(["undecided", "granted", "declined"]);
export const CONSENT_PURPOSES = Object.freeze(["sharing", "ratings", "voice_cues"]);
export const QUESTIONNAIRE_KINDS = Object.freeze(["phq2", "phq9"]);

export const COLLECTIONS = Object.freeze({
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
});

export const PATIENT_SUBCOLLECTIONS = Object.freeze([
  "daily",
  "consents",
  "checkIns",
  "summaries",
  "suggestions",
  "flags",
  "visits",
  "digests",
]);
