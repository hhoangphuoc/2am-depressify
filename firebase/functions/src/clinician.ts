// Who may act as a Patient's Clinician in a function. The functions use the Admin SDK, which
// bypasses the security rules, so every Clinician-only function checks here instead. This mirrors
// `clinicianCanRead` / `clinicianCanWrite` in firestore.rules.
import { HttpsError } from "firebase-functions/v2/https";
import type { PatientDoc } from "./types";

/** The parts of a callable request's auth context that the check reads. */
export interface CallerAuth {
  uid: string;
  token: { email?: string | null; [claim: string]: unknown };
}

/**
 * Throws unless the caller is signed in with the email this Patient is linked to.
 *
 * - No auth: `unauthenticated`.
 * - Missing Patient, no email, or another email: `permission-denied`, with one message for all
 *   three, so a caller cannot learn which Patient ids exist.
 *
 * The one place that decides Clinician access in functions. Issue #29 adds the sharing Consent
 * gate here (`patient.sharingConsent == "granted"`), as in `clinicianCanRead` in the rules.
 *
 * DEMO ONLY, as in the rules: the email is trusted without `email_verified`, because accounts
 * created in the Auth emulator are unverified. Production must also require
 * `auth.token.email_verified === true`.
 */
export function assertClinicianOf(
  patient: Partial<PatientDoc> | undefined,
  auth: CallerAuth | undefined,
): asserts patient is Partial<PatientDoc> {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  const email = typeof auth.token.email === "string" ? auth.token.email : null;
  if (!patient || email === null || patient.clinicianEmail !== email) {
    throw new HttpsError("permission-denied", "Only this Patient's Clinician can do this.");
  }
}
