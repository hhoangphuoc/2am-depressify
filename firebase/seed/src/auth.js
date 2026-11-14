// The Auth side of allowing a Clinician (ADR 0010): the security rules and the functions read a
// Clinician only from an account with the custom claim `role: "clinician"` and a verified email.
// The Admin vouches for the Clinician, so the email is marked verified here.

import { CLINICIAN_ROLE } from "../../hosting/js/lib/auth.js";

/** @typedef {import("firebase-admin/auth").Auth} Auth */

/**
 * Gives the Auth account with this email the claim `role: "clinician"` (keeping any other claims)
 * and marks its email verified. Running it again changes nothing. The Clinician picks the claim
 * up at their next sign-in or ID token refresh (the dashboard refreshes a token without the claim
 * on every load).
 *
 * A verified email proves the account belongs to whoever reads that inbox (or its Google account).
 * An unverified one proves nothing, since sign-up is open: anyone could have registered the
 * Clinician's address first. So it is refused unless `uid` names it, the account the admin added.
 * @param {Auth} auth
 * @param {string} email trimmed and lower case (see `clinicianEmail` in cli.js)
 * @param {string | null} uid the unverified account the admin vouches for, or null
 * @returns {Promise<{ uid: string } | null>} the account, or null when no account has this email yet
 */
export async function grantClinicianRole(auth, email, uid) {
  /** @type {import("firebase-admin/auth").UserRecord} */
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (error) {
    if (/** @type {{ code?: string }} */ (error)?.code === "auth/user-not-found") return null;
    throw error;
  }
  if (!user.emailVerified && user.uid !== uid) {
    throw new Error(
      `The account with the email ${email} has not verified its email, so anyone could have made it; nothing was changed. ` +
        `If you added it in the console, run this again with --uid <its User UID> (Authentication → Users).`,
    );
  }
  await auth.setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), role: CLINICIAN_ROLE });
  await auth.updateUser(user.uid, { emailVerified: true });
  return { uid: user.uid };
}
