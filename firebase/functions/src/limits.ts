// Hourly caps the functions keep per Patient, in `patientLimits/{patientId}` (functions only; no
// client can read or write it, so a client cannot reset a cap). The document also records who
// started each recent Check-in, so only that caller can finish it on a Demo Patient.
//
// Pure: the stores read the document, call these, and write the result in a transaction.

/** The top-level collection. Not part of the data contract: no client and no dashboard reads it. */
export const PATIENT_LIMITS = "patientLimits";

/** The caps count what happened in the last hour. */
export const LIMIT_WINDOW_MS = 60 * 60 * 1000;

/** Check-ins one Patient record may start per hour. Each start mints a Gemini Live token. */
export const MAX_CHECK_IN_STARTS_PER_HOUR = 10;

/** Red flag emails one Patient record may cause per hour. Flags past the cap are still recorded. */
export const MAX_RED_FLAG_EMAILS_PER_HOUR = 5;

/** One Check-in Start Check-in created: its id, the caller and the server time. */
export interface CheckInStart {
  checkInId: string;
  uid: string;
  startedAtMillis: number;
}

/** `patientLimits/{patientId}`. */
export interface PatientLimits {
  checkInStarts?: CheckInStart[];
  redFlagEmailsAtMillis?: number[];
}

function isStart(value: unknown): value is CheckInStart {
  const start = value as Partial<CheckInStart> | null;
  return typeof start?.checkInId === "string" && typeof start.uid === "string" && typeof start.startedAtMillis === "number";
}

/** The stored starts, whatever their age. Anything malformed is dropped. */
export function storedStarts(value: unknown): CheckInStart[] {
  return Array.isArray(value) ? value.filter(isStart) : [];
}

/**
 * The starts to store after one more, or null when the Patient has reached the hourly cap. Starts
 * older than an hour are dropped here, so the document never grows past the cap.
 */
export function withStart(stored: unknown, start: CheckInStart): CheckInStart[] | null {
  const recent = storedStarts(stored).filter((s) => s.startedAtMillis > start.startedAtMillis - LIMIT_WINDOW_MS);
  return recent.length >= MAX_CHECK_IN_STARTS_PER_HOUR ? null : [...recent, start];
}

/** The email times to store after one more, or null when the Patient has reached the hourly cap. */
export function withEmail(stored: unknown, nowMillis: number): number[] | null {
  const recent = Array.isArray(stored)
    ? stored.filter((t): t is number => typeof t === "number" && t > nowMillis - LIMIT_WINDOW_MS)
    : [];
  return recent.length >= MAX_RED_FLAG_EMAILS_PER_HOUR ? null : [...recent, nowMillis];
}
