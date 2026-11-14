import type { PatientDoc } from "./types";

/**
 * Whether the Patient currently shares their progress with their Clinician (issue #29).
 *
 * Functions use the Admin SDK, which bypasses the security rules, so every function that acts for
 * the Clinician must check this itself. While it is false:
 * - no flag email is sent for the Patient (`redFlagAlert`, #22): flags are still recorded, so the
 *   Patient's own record stays complete, but the Clinician is not alerted;
 * - the silence check skips the Patient (#28).
 * - the weekly Digest skips the Patient and "Generate now" is refused (#23).
 * Check-ins, Summaries and the Patient's own records continue as usual. Re-granting shares from
 * then on only: nothing raised while sharing was off is emailed afterwards, and the Clinician never
 * reads what was saved while sharing was off (see `sharingStamp`).
 *
 * Undecided, declined and a missing or unknown value all mean "not sharing".
 */
export function isSharingActive(patient: Partial<Pick<PatientDoc, "sharingConsent">> | null | undefined): boolean {
  return patient?.sharingConsent === "granted";
}

/**
 * The `sharedWithClinician` stamp for a document a function creates now in daily, checkIns,
 * summaries, suggestions, flags or digests: true only while the Patient shares (`isSharingActive`).
 *
 * The security rules let the Clinician read only documents stamped true, so nothing saved while
 * sharing was off ever reaches them, and what was saved during an earlier sharing period is visible
 * again once the Patient shares again. Clients must stamp the same way (the rules check it on create)
 * and never change the stamp; functions use the Admin SDK, which bypasses the rules, so every
 * function writer calls this. A function that rewrites an existing document keeps the stamp it has.
 *
 * Writers: the weekly Digest (#23) today; Finish Check-in (#14) for the Summary, the Check-in's
 * ratings and the Outcome; the silence check (#28) for its flag. The phone's Kotlin twin is
 * `PatientDoc.sharingStamp()` in core.
 */
export function sharingStamp(patient: Partial<Pick<PatientDoc, "sharingConsent">> | null | undefined): boolean {
  return isSharingActive(patient);
}
