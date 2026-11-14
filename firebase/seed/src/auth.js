// The Auth side of allowing a Clinician (ADR 0010): the security rules and the functions read a
// Clinician only from an account with the custom claim `role: "clinician"` and a verified email.
// The Admin vouches for the Clinician, so the email is marked verified here.

/** @typedef {import("firebase-admin/auth").Auth} Auth */

/** The custom claim value the rules and functions check. */
export const CLINICIAN_ROLE = "clinician";

/**
 * Gives the Auth account with this email the claim `role: "clinician"` (keeping any other claims)
 * and marks its email verified. Running it again changes nothing. The Clinician picks the claim
 * up at their next sign-in or ID token refresh (the dashboard refreshes on every load).
 * @param {Auth} auth
 * @param {string} email trimmed and lower case (see `clinicianEmail` in cli.js)
 * @returns {Promise<{ uid: string } | null>} the account, or null when no account has this email yet
 */
export async function grantClinicianRole(auth, email) {
  /** @type {import("firebase-admin/auth").UserRecord} */
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (error) {
    if (/** @type {{ code?: string }} */ (error)?.code === "auth/user-not-found") return null;
    throw error;
  }
  await auth.setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), role: CLINICIAN_ROLE });
  await auth.updateUser(user.uid, { emailVerified: true });
  return { uid: user.uid };
}
