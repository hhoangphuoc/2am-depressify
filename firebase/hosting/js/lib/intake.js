// Pure helpers for the Intake section: limits, validation, vetted copy and the state machine.
// No Firebase imports, so `node --test` can run them. The limits match
// firebase/functions/src/intake.ts; a functions test checks that the two agree.

/** Intake highlights are at most this many words. */
export const INTAKE_MAX_WORDS = 120;
/** The longest report accepted, in characters. */
export const REPORT_MAX_CHARS = 100_000;

/**
 * Words are runs of non-space characters that contain a letter or a digit, so a bullet "-" is not
 * a word. The function counts the same way.
 * @param {string} text
 * @returns {number}
 */
export function countWords(text) {
  return (String(text ?? "").match(/\S+/g) ?? []).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/**
 * Why a pasted report cannot be sent, or null when it can. Checked before any call.
 * @param {string} text
 * @returns {string | null}
 */
export function reportProblem(text) {
  const value = String(text ?? "");
  if (value.trim() === "") return "Paste the report text first.";
  if (value.length > REPORT_MAX_CHARS) {
    return `The report is too long. Paste at most ${REPORT_MAX_CHARS.toLocaleString("en")} characters.`;
  }
  return null;
}

/**
 * Why the highlights cannot be saved, or null when they can.
 * @param {string} text
 * @returns {string | null}
 */
export function highlightsProblem(text) {
  const words = countWords(text);
  if (words === 0) return "The highlights are empty. Write at least one line, or cancel.";
  if (words > INTAKE_MAX_WORDS) {
    return `Highlights are at most ${INTAKE_MAX_WORDS} words. Remove ${words - INTAKE_MAX_WORDS} to save.`;
  }
  return null;
}

/**
 * @param {string} text
 * @returns {string}
 */
export function wordCountLabel(text) {
  return `${countWords(text)} of ${INTAKE_MAX_WORDS} words`;
}

/**
 * Vetted copy for a failed call. Never returns the raw error text.
 * @param {"extract" | "save"} stage
 * @param {{ code?: string } | undefined} error a Firebase Functions error, code like "functions/permission-denied"
 * @returns {string}
 */
export function intakeErrorMessage(stage, error) {
  const code = String(error?.code ?? "").replace(/^functions\//, "");
  switch (code) {
    case "permission-denied":
      return "Only this Patient's Clinician can change the Intake.";
    case "unauthenticated":
      return "Your sign-in has ended. Sign in again, then try again.";
    case "invalid-argument":
      return stage === "extract"
        ? "This report could not be used. Check the pasted text and try again."
        : `These highlights could not be saved. Keep them to ${INTAKE_MAX_WORDS} words and try again.`;
    default:
      return stage === "extract"
        ? "Could not extract highlights. Check your connection and try again."
        : "Could not save the highlights. Check your connection and try again.";
  }
}

// ---------------------------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------------------------
//
//   view ──start──▶ compose ──extract──▶ extracting ──succeeded──▶ review ──save──▶ saving ──succeeded──▶ view
//                     ▲  ▲                    │                     │  ▲              │
//                     │  └──── failed ────────┘                     │  └── failed ────┘
//                     └──────────────── backToReport ───────────────┘
//
// A failure returns to the form it came from with the text kept and `failed` set, so the page
// shows the message and a retry. `cancel` from any idle mode drops the report and the draft.

/**
 * @typedef {"view" | "compose" | "extracting" | "review" | "saving"} IntakeMode
 * @typedef {object} IntakeState
 * @property {IntakeMode} mode
 * @property {string} report the pasted report; held in memory only, never saved
 * @property {string} draft the highlights under review
 * @property {boolean} trimmed whether the extracted highlights were cut to the word limit
 * @property {string | null} error a message to show, or null
 * @property {"extract" | "save" | null} failed which call failed last, so the page offers a retry
 */

/** @returns {IntakeState} */
export function initialIntakeState() {
  return { mode: "view", report: "", draft: "", trimmed: false, error: null, failed: null };
}

/** True while a call is in flight: edits and cancel are ignored. @param {IntakeState} state */
export function isBusy(state) {
  return state.mode === "extracting" || state.mode === "saving";
}

/**
 * @param {IntakeState} state
 * @param {{ type: string, text?: string, highlights?: string, trimmed?: boolean, message?: string }} action
 * @returns {IntakeState}
 */
export function intakeReducer(state, action) {
  switch (action.type) {
    case "start":
      return state.mode === "view" ? { ...initialIntakeState(), mode: "compose" } : state;

    case "editReport":
      return state.mode === "compose" ? { ...state, report: action.text ?? "", error: null, failed: null } : state;

    case "extract": {
      if (state.mode !== "compose") return state;
      const problem = reportProblem(state.report);
      if (problem) return { ...state, error: problem, failed: null };
      return { ...state, mode: "extracting", error: null, failed: null };
    }

    case "extractSucceeded":
      if (state.mode !== "extracting") return state;
      return { ...state, mode: "review", draft: action.highlights ?? "", trimmed: Boolean(action.trimmed) };

    case "extractFailed":
      if (state.mode !== "extracting") return state;
      return { ...state, mode: "compose", error: action.message ?? null, failed: "extract" };

    case "editDraft":
      return state.mode === "review" ? { ...state, draft: action.text ?? "", error: null, failed: null } : state;

    case "save": {
      if (state.mode !== "review") return state;
      const problem = highlightsProblem(state.draft);
      if (problem) return { ...state, error: problem, failed: null };
      return { ...state, mode: "saving", error: null, failed: null };
    }

    case "saveSucceeded":
      return state.mode === "saving" ? initialIntakeState() : state;

    case "saveFailed":
      if (state.mode !== "saving") return state;
      return { ...state, mode: "review", error: action.message ?? null, failed: "save" };

    case "backToReport":
      return state.mode === "review"
        ? { ...state, mode: "compose", draft: "", trimmed: false, error: null, failed: null }
        : state;

    case "cancel":
      return isBusy(state) ? state : initialIntakeState();

    default:
      return state;
  }
}
