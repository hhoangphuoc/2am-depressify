import type { PatientDoc } from "./types";

/**
 * Whether the Patient currently shares their progress with their Clinician (issue #29).
 *
 * Functions use the Admin SDK, which bypasses the security rules, so every function that acts for
 * the Clinician must check this itself. While it is false:
 * - no flag email is sent for the Patient (Flag email, #22): flags are still recorded, so the
 *   Patient's own record stays complete, but the Clinician is not alerted;
 * - the silence check skips the Patient (#28).
 * Check-ins, Summaries and the Patient's own records continue as usual. Re-granting shares from
 * then on only: nothing raised while sharing was off is emailed afterwards.
 *
 * Undecided, declined and a missing or unknown value all mean "not sharing".
 */
export function isSharingActive(patient: Partial<Pick<PatientDoc, "sharingConsent">> | null | undefined): boolean {
  return patient?.sharingConsent === "granted";
}
