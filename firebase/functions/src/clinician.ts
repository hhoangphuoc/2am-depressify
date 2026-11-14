// Who may act as a Patient's Clinician in a function. The functions use the Admin SDK, which
// bypasses the security rules, so every Clinician-only function checks here instead. This mirrors
// `clinicianCanRead` / `clinicianCanWrite` in firestore.rules.
import { HttpsError } from "firebase-functions/v2/https";
import { isSharingActive } from "./sharing";
import type { PatientDoc } from "./types";

/** The parts of a callable request's auth context that the checks read. */
export interface CallerAuth {
  uid: string;
  token: {
    email?: string | null;
    email_verified?: boolean;
    /** Set by the Admin on a Clinician's account (`npm run allow-clinician` in firebase/seed). */
    role?: unknown;
    firebase?: { sign_in_provider?: string };
    [claim: string]: unknown;
  };
}

/** The custom claim that makes an account a Clinician's (ADR 0010). */
export const CLINICIAN_ROLE = "clinician";

/**
 * The person's own account: not anonymous, and its email verified (Google accounts arrive
 * verified; email and password accounts after the verification link). Mirrors `verifiedAccount()`
 * in firestore.rules.
 */
export function isVerifiedAccount(auth: CallerAuth): boolean {
  return auth.token.firebase?.sign_in_provider !== "anonymous" && auth.token.email_verified === true;
}

/**
 * Throws unless the caller is this Patient's Clinician: a verified account with the custom claim
 * `role: "clinician"`, signed in with the email this Patient is linked to, while the Patient shares.
 *
 * - No auth: `unauthenticated`.
 * - No claim, an unverified email, no email or another email, a missing Patient, or a Patient not
 *   sharing (issue #29, `isSharingActive`): `permission-denied`, with one message for all, so a
 *   caller cannot learn which Patient ids exist. A Patient's account never has the claim, so a
 *   Patient never passes, whatever their email.
 *
 * The one place that decides Clinician access in functions.
 */
export function assertClinicianOf(
  patient: Partial<PatientDoc> | undefined,
  auth: CallerAuth | undefined,
): asserts patient is Partial<PatientDoc> {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  const email = typeof auth.token.email === "string" ? auth.token.email : null;
  const clinician = isVerifiedAccount(auth) && auth.token.role === CLINICIAN_ROLE;
  if (!clinician || !patient || email === null || patient.clinicianEmail !== email || !isSharingActive(patient)) {
    throw new HttpsError("permission-denied", "Only this Patient's Clinician can do this.");
  }
}
