// Who may act as a Patient in a function: the Patient themselves, or, as the demo shortcut, any
// verified account on a Patient marked synthetic. This mirrors `actsAsPatient` in firestore.rules;
// the functions use the Admin SDK, which bypasses the rules, so every Patient-side callable checks here.
import { HttpsError } from "firebase-functions/v2/https";
import { isVerifiedAccount, type CallerAuth } from "./clinician";
import type { PatientDoc } from "./types";

/** What an anonymous or unverified caller is told. The app shows it with the way to verify. */
export const VERIFY_ACCOUNT_MESSAGE = "Verify your account to start a Check-in.";

/**
 * Throws unless the caller may act as this Patient, with an account of their own. Start and
 * Finish Check-in call it: both spend Gemini credit, which an anonymous account could spend
 * without limit (ADR 0010).
 *
 * - No auth: `unauthenticated`.
 * - Anonymous, or an email not yet verified: `failed-precondition`, `VERIFY_ACCOUNT_MESSAGE`. This
 *   includes a Patient who signed in anonymously before ADR 0010: their records stay theirs under
 *   the rules, but a Check-in waits until they upgrade the account (keeping the uid) and verify it.
 *   It depends only on the caller's token, so it says nothing about the Patient id.
 * - Missing Patient, or another user on a Patient who is not synthetic: `permission-denied`, with
 *   one message for both, so a caller cannot learn which Patient ids exist.
 *
 * The demo shortcut follows the rules: any verified account acts as a Demo Patient (`synthetic: true`).
 */
export function assertActsAsPatient(
  patientId: string,
  patient: Partial<PatientDoc> | undefined,
  auth: CallerAuth | undefined,
): asserts patient is Partial<PatientDoc> {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  if (!isVerifiedAccount(auth)) throw new HttpsError("failed-precondition", VERIFY_ACCOUNT_MESSAGE);
  if (!patient || (auth.uid !== patientId && patient.synthetic !== true)) {
    throw new HttpsError("permission-denied", "Only this Patient can do this.");
  }
}
