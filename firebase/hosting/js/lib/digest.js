// Pure helpers for the weekly Digest on the Patient page: the "Generate now" state machine and the
// vetted copy. No Firebase imports, so `node --test` can run them. The Digest itself is written by
// the functions (firebase/functions/src/digestFunctions.ts); the page only reads the latest one
// and calls `generateDigest`.

export const DIGEST_TIME_ZONE = "Europe/Helsinki";

// ---------------------------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------------------------
//
//   idle ──generate──▶ generating ──succeeded──▶ regenerated ──generate──▶ generating …
//                        │    ▲
//                     failed  └── generate (retry)
//                        ▼        │
//                      failed ────┘
//
// `generate` is ignored while generating, so "Generate now" cannot run twice at once. The last
// Digest stays on screen while generating and after a failure. `loaded` comes from the live
// listener at any time and never changes the phase.

/**
 * @typedef {"idle" | "generating" | "failed" | "regenerated"} DigestPhase
 * @typedef {object} DigestState
 * @property {DigestPhase} phase
 * @property {import("./contract.js").Digest | null} digest the latest Digest, or null when there is none
 * @property {boolean} loaded whether the listener has answered
 * @property {boolean} loadFailed whether the listener failed
 * @property {boolean} hadDigest whether a Digest existed when the last generate started
 * @property {string | null} error vetted copy for a failed generate
 */

/** @returns {DigestState} */
export function initialDigestState() {
  return { phase: "idle", digest: null, loaded: false, loadFailed: false, hadDigest: false, error: null };
}

/** @param {DigestState} state */
export function isGenerating(state) {
  return state.phase === "generating";
}

/**
 * @param {DigestState} state
 * @param {{ type: string, digest?: import("./contract.js").Digest | null, message?: string }} action
 * @returns {DigestState}
 */
export function digestReducer(state, action) {
  switch (action.type) {
    case "loaded":
      return { ...state, digest: action.digest ?? null, loaded: true, loadFailed: false };

    case "loadFailed":
      return { ...state, digest: null, loaded: true, loadFailed: true };

    case "generate":
      if (isGenerating(state)) return state;
      return { ...state, phase: "generating", hadDigest: state.digest !== null, error: null };

    case "generateSucceeded":
      if (!isGenerating(state)) return state;
      return { ...state, phase: "regenerated", digest: action.digest ?? state.digest, error: null };

    case "generateFailed":
      if (!isGenerating(state)) return state;
      return { ...state, phase: "failed", error: action.message ?? digestErrorMessage(undefined) };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------------------------

/** @param {DigestState} state */
export function digestButtonLabel(state) {
  if (state.phase === "generating") return "Generating…";
  if (state.phase === "failed") return "Try again";
  return "Generate now";
}

/** The line under the button: progress, the result or the failure. */
export function digestStatus(state) {
  switch (state.phase) {
    case "generating":
      return "Generating this week's Digest…";
    case "failed":
      return state.error ?? digestErrorMessage(undefined);
    case "regenerated":
      return state.hadDigest ? "Digest regenerated." : "Digest generated.";
    default:
      return state.loadFailed ? "Could not load the Digest. Reload the page to try again." : "";
  }
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** @param {string} date yyyy-MM-dd */
function parts(date) {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return { year: y, month: MONTHS[m - 1], day: d, weekday: WEEKDAYS[weekday] };
}

/** @param {string} date @param {boolean} withYear */
function longDate(date, withYear) {
  const p = parts(date);
  return `${p.weekday} ${p.day} ${p.month}${withYear ? ` ${p.year}` : ""}`;
}

/**
 * The dates a Digest covers, e.g. "Monday 9 November to Sunday 15 November 2026". A week still in
 * progress (it ends before Sunday) says so.
 * @param {Pick<import("./contract.js").Digest, "weekStart" | "weekEnd">} digest
 */
export function digestCoverage(digest) {
  const inProgress = parts(digest.weekEnd).weekday !== "Sunday" ? " (the week so far)" : "";
  if (digest.weekStart === digest.weekEnd) return `${longDate(digest.weekStart, true)}${inProgress}`;
  const sameYear = digest.weekStart.slice(0, 4) === digest.weekEnd.slice(0, 4);
  return `${longDate(digest.weekStart, !sameYear)} to ${longDate(digest.weekEnd, true)}${inProgress}`;
}

/** How many Summaries the Digest drew on. @param {Pick<import("./contract.js").Digest, "summaryCount">} digest */
export function digestSource(digest) {
  const n = digest.summaryCount;
  if (n === 0) return "No Check-ins in these dates";
  return `Drawn from ${n} ${n === 1 ? "Summary" : "Summaries"}`;
}

/**
 * When it was generated, in Helsinki time: "Generated 14 November 2026 at 12:32".
 * @param {number} millis
 */
export function digestGenerated(millis, timeZone = DIGEST_TIME_ZONE) {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(millis));
  /** @type {Record<string, string>} */
  const p = {};
  for (const part of formatted) p[part.type] = part.value;
  return `Generated ${Number(p.day)} ${MONTHS[Number(p.month) - 1]} ${p.year} at ${p.hour}:${p.minute}`;
}

/**
 * Vetted copy for a failed "Generate now". Never returns the raw error text.
 * @param {{ code?: string } | undefined} error a Firebase Functions error, code like "functions/unavailable"
 */
export function digestErrorMessage(error) {
  const code = String(error?.code ?? "").replace(/^functions\//, "");
  switch (code) {
    case "permission-denied":
      return "Only this Patient's Clinician can generate a Digest, while the Patient is sharing.";
    case "unauthenticated":
      return "Your sign-in has ended. Sign in again, then try again.";
    default:
      return "Could not generate the Digest. Check your connection and try again.";
  }
}
