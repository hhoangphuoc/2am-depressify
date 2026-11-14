// Pure helpers for sign-in. No Firebase imports, so `node --test` can run them.

const NETWORK_MESSAGE = "Could not reach the sign-in service. Check your connection and try again.";
const TOO_MANY_MESSAGE = "Too many attempts. Wait a moment and try again.";
// One message for every credential problem, so the page never reveals whether an account exists.
const CREDENTIALS_MESSAGE = "The email or password is not correct.";

/**
 * Maps a Firebase Auth error to vetted copy. Never returns the raw error text.
 * @param {{ code?: string }} error
 * @returns {string}
 */
export function signInErrorMessage(error) {
  switch (error?.code) {
    case "auth/network-request-failed":
      return NETWORK_MESSAGE;
    case "auth/too-many-requests":
      return TOO_MANY_MESSAGE;
    default:
      return CREDENTIALS_MESSAGE;
  }
}

/** The custom claim value that makes an account a Clinician's (ADR 0010), as the rules check it. */
export const CLINICIAN_ROLE = "clinician";

// Shown after a correct password when the account lacks the Clinician's claim or a verified email
// (ADR 0010). Both come from the admin's `npm run allow-clinician`, so the message names that step.
const NOT_CLINICIAN_MESSAGE =
  "This account isn't set up as a Clinician yet. Ask the Admin to add it as a Clinician, then sign in again.";

/**
 * Why a signed-in account may not use the dashboard, or null when it may. The Clinician's ID token
 * carries the custom claim `role: "clinician"` and a verified email, as the security rules require;
 * any other account (a Patient's included) would see nothing, so it is turned away with a reason.
 * @param {Record<string, unknown> | null | undefined} claims the ID token's claims
 * @returns {string | null}
 */
export function clinicianAccessMessage(claims) {
  return claims?.role === CLINICIAN_ROLE && claims?.email_verified === true ? null : NOT_CLINICIAN_MESSAGE;
}

const ACCESS_CHECK_FAILED_MESSAGE = "Could not check this account. Sign in again.";

/**
 * Why this signed-in user may not use the dashboard, or null. Reads the cached ID token first, so a
 * Clinician gets in on a reload without the network; only a token without the claim is refreshed,
 * so a claim the admin has just set counts. A lost connection lets the user stay: the security
 * rules, not this check, decide what the account reads.
 * @param {{ getIdTokenResult(forceRefresh?: boolean): Promise<{ claims: Record<string, unknown> }> }} user
 * @returns {Promise<string | null>}
 */
export async function clinicianAccessProblem(user) {
  try {
    const cached = clinicianAccessMessage((await user.getIdTokenResult()).claims);
    return cached && clinicianAccessMessage((await user.getIdTokenResult(true)).claims);
  } catch (error) {
    return /** @type {{ code?: string }} */ (error)?.code === "auth/network-request-failed" ? null : ACCESS_CHECK_FAILED_MESSAGE;
  }
}

/**
 * The emulator host to use for a page served from `hostname`, or null to use the real project.
 * @param {string} hostname
 * @returns {string | null}
 */
export function emulatorHostFor(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" ? "127.0.0.1" : null;
}
