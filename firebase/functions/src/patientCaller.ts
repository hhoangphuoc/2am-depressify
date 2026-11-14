// Who may act as a Patient in a function: the Patient themselves, or, as the demo shortcut, anyone
// signed in on a Patient marked synthetic. This mirrors `actsAsPatient` in firestore.rules; the
// functions use the Admin SDK, which bypasses the rules, so every Patient-side callable checks here.
import { HttpsError } from "firebase-functions/v2/https";
import type { CallerAuth } from "./clinician";
import type { PatientDoc } from "./types";

/**
 * Throws unless the caller may act as this Patient.
 *
 * - No auth: `unauthenticated`.
 * - Missing Patient, or another user on a Patient who is not synthetic: `permission-denied`, with
 *   one message for both, so a caller cannot learn which Patient ids exist.
 *
 * The demo shortcut follows the rules: any signed-in user acts as a Demo Patient (`synthetic: true`).
 */
export function assertActsAsPatient(
  patientId: string,
  patient: Partial<PatientDoc> | undefined,
  auth: CallerAuth | undefined,
): asserts patient is Partial<PatientDoc> {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  if (!patient || (auth.uid !== patientId && patient.synthetic !== true)) {
    throw new HttpsError("permission-denied", "Only this Patient can do this.");
  }
}
