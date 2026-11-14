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

/**
 * The emulator host to use for a page served from `hostname`, or null to use the real project.
 * @param {string} hostname
 * @returns {string | null}
 */
export function emulatorHostFor(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" ? "127.0.0.1" : null;
}
