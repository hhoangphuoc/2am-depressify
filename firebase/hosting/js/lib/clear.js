// "Clear after follow-up": the Clinician clears one flag once they have followed up. No Firebase
// imports, so `node --test` can run it: clearFlags takes the Firestore functions it uses, which lets
// the page pass the browser SDK and the emulator tests pass the npm one.
//
// Write rules (spec, Attention flag): only the Clinician clears a flag, and history is kept (the
// flag gets a cleared time, nothing is deleted). The Patient's level becomes the highest flag still
// open, or green, with the open flags' reasons. A reason raised while the Clinician was reviewing
// asks for a new review instead of being cleared unseen.
//
// Which flags count: the Clinician reads only flags stamped `sharedWithClinician` (raised while the
// Patient was sharing), and only those count toward the Patient's `flagLevel` (a flag raised while
// not sharing never does), so "the flags still open" here are all the flags that make the level.
//
// Which flags one clear covers: one flag. The Clinician clears the flag they followed up on; any
// other open flag stays, and the Patient's level drops only to the highest of those. This keeps
// "nothing but the Clinician lowers a level" true flag by flag: clearing a crisis never also clears
// a drift flag the Clinician has not looked at, and the dialog shows what stays open.
import { isOpen } from "./banner.js";
import { patientCollectionQuery } from "./sharing.js";
import { levelRank } from "./sort.js";

/** @typedef {"green" | "amber" | "red"} FlagLevel */

/**
 * @typedef {object} FlagRecord
 * @property {string} id
 * @property {string} [level]
 * @property {string} [reason]
 * @property {number} [raisedAtMillis]
 * @property {number | null} [clearedAtMillis]
 */

/**
 * What the Clinician saw when they chose to clear: the Patient's level and reasons, and which
 * flags were open.
 * @typedef {{ flagLevel: string, flagReasons: string[], openFlagIds: string[] }} Review
 */

/** @param {string | undefined} level @returns {FlagLevel} */
const known = (level) => (level === "red" || level === "amber" ? level : "green");

const time = (/** @type {unknown} */ m) => (typeof m === "number" ? m : 0);

/**
 * The Patient's level and reasons once `clearIds` are cleared: the highest flag still open, or
 * green, and the open flags' reasons from the highest level, newest first, each once.
 * @param {FlagRecord[]} flags
 * @param {string[]} clearIds
 * @returns {{ flagLevel: FlagLevel, flagReasons: string[] }}
 */
export function levelAfterClearing(flags, clearIds) {
  const clearing = new Set(clearIds);
  const remaining = flags
    .filter((f) => isOpen(f) && !clearing.has(f.id))
    .sort((a, b) => levelRank(a.level) - levelRank(b.level) || time(b.raisedAtMillis) - time(a.raisedAtMillis));
  /** @type {string[]} */
  const reasons = [];
  for (const f of remaining) {
    const reason = typeof f.reason === "string" ? f.reason.trim() : "";
    if (reason && !reasons.includes(reason)) reasons.push(reason);
  }
  return { flagLevel: known(remaining[0]?.level), flagReasons: reasons };
}

/**
 * The Attention level and reasons the dashboard shows: from the open flags the Clinician can see
 * when they are loaded, so a reason never appears without its flag; from the Patient record only
 * until they arrive (or when they could not be read). The record counts the same flags, so the
 * two agree once the flags load.
 * @param {{ flagLevel?: string, flagReasons?: unknown }} patient
 * @param {FlagRecord[] | null | undefined} flags the visible flags, or null/undefined while unknown
 * @returns {{ flagLevel: FlagLevel, flagReasons: string[] }}
 */
export function shownAttention(patient, flags) {
  if (Array.isArray(flags)) return levelAfterClearing(flags, []);
  return {
    flagLevel: known(patient?.flagLevel),
    flagReasons: Array.isArray(patient?.flagReasons) ? patient.flagReasons.filter((r) => typeof r === "string" && r) : [],
  };
}

/**
 * @param {{ flagLevel?: string, flagReasons?: unknown }} patient
 * @param {FlagRecord[]} flags
 * @returns {Review}
 */
export function reviewOf(patient, flags) {
  return {
    flagLevel: known(patient.flagLevel),
    flagReasons: Array.isArray(patient.flagReasons) ? patient.flagReasons.filter((r) => typeof r === "string") : [],
    openFlagIds: flags
      .filter(isOpen)
      .map((f) => f.id)
      .sort(),
  };
}

/** @param {string[]} a @param {string[]} b */
const sameSet = (a, b) => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((x) => right.has(x));
};

/**
 * True when anything the Clinician reviewed has changed: a new or removed reason, a new or cleared
 * flag, or another level.
 * @param {Review} reviewed
 * @param {Review} current
 */
export function reviewChanged(reviewed, current) {
  return (
    reviewed.flagLevel !== current.flagLevel ||
    !sameSet(reviewed.flagReasons, current.flagReasons) ||
    !sameSet(reviewed.openFlagIds, current.openFlagIds)
  );
}

/** @param {"flag/changed" | "flag/not-open" | "flag/missing"} code */
function clearError(code) {
  const error = new Error(code);
  /** @type {any} */ (error).code = code;
  return error;
}

/**
 * Clears `flagIds` on one Patient in one transaction: sets each flag's `clearedAtMillis` and resets
 * the Patient's `flagLevel` and `flagReasons` to what stays open. Nothing is deleted.
 *
 * A flag raised since the review is a new document, which a transaction cannot query for, so the
 * open flags are listed first. Inside the transaction the Patient record and the reviewed flags are
 * read again; the phone writes a new flag and the raised level and reasons in one batch, so a flag
 * raised after the listing changes the Patient record and the transaction sees it (or retries).
 * Any difference from the review rejects with code `flag/changed` and writes nothing.
 *
 * @param {{ runTransaction: Function, doc: Function, collection: Function, query: Function, where: Function, getDocs: Function }} fs
 *   the Firestore functions (browser SDK on the page, the npm SDK in the emulator tests)
 * @param {unknown} db
 * @param {{ patientId: string, flagIds: string[], reviewed: Review, nowMillis: number }} request
 * @returns {Promise<{ flagLevel: FlagLevel, flagReasons: string[] }>}
 */
export async function clearFlags(fs, db, { patientId, flagIds, reviewed, nowMillis }) {
  const { runTransaction, doc, getDocs } = fs;
  if (flagIds.length === 0 || !flagIds.every((id) => reviewed.openFlagIds.includes(id))) throw clearError("flag/not-open");

  // The flags the Clinician can see: the sharing filter is required by the rules.
  const listed = await getDocs(patientCollectionQuery(fs, db, patientId, "flags"));
  const openNow = listed.docs.filter((/** @type {any} */ d) => isOpen(d.data())).map((/** @type {any} */ d) => d.id);
  if (!sameSet(openNow, reviewed.openFlagIds)) throw clearError("flag/changed");

  const patientRef = doc(db, "patients", patientId);
  const flagRef = (/** @type {string} */ id) => doc(db, "patients", patientId, "flags", id);
  return runTransaction(db, async (/** @type {any} */ tx) => {
    const patient = await tx.get(patientRef);
    if (!patient.exists()) throw clearError("flag/missing");
    const snaps = await Promise.all(reviewed.openFlagIds.map((id) => tx.get(flagRef(id))));
    /** @type {FlagRecord[]} */
    const flags = snaps.filter((s) => s.exists()).map((s) => ({ ...s.data(), id: s.id }));
    if (reviewChanged(reviewed, reviewOf(patient.data(), flags))) throw clearError("flag/changed");

    const next = levelAfterClearing(flags, flagIds);
    for (const id of flagIds) tx.update(flagRef(id), { clearedAtMillis: nowMillis });
    tx.update(patientRef, next);
    return next;
  });
}

/**
 * Vetted copy for a failed clear. Never returns the raw error text. `flag/changed` is not an error
 * for the Clinician; the dialog shows it as a new review.
 * @param {{ code?: string } | undefined} error
 */
export function clearErrorMessage(error) {
  const code = String(error?.code ?? "").replace(/^firestore\//, "");
  if (code === "permission-denied") {
    return "You can no longer clear this flag. The Patient may have stopped sharing with you.";
  }
  return "Could not clear the flag. Check your connection and try again.";
}

// ---------------------------------------------------------------------------------------------
// The dialog's state
// ---------------------------------------------------------------------------------------------
//
//   closed ──open──▶ review ──save──▶ saving ──saved──▶ closed
//                     ▲  │              │
//                     │  └─ cancel ─▶ closed (not while saving)
//                     ├──── failed ─────┤   (error shown, dialog stays open)
//                     └──── changed ────┘   (new review: what is open now, notice shown)
//
// While reviewing, every live update of the Patient is passed as `current`. A difference from the
// review becomes a new review; if the flag being cleared is no longer open, the dialog closes.

/**
 * @typedef {object} ClearDialogState
 * @property {"closed" | "review" | "saving"} mode
 * @property {string | null} flagId
 * @property {Review | null} reviewed
 * @property {string | null} error
 * @property {boolean} changed true when the review was renewed because something changed
 */

/** @returns {ClearDialogState} */
export function initialClearDialog() {
  return { mode: "closed", flagId: null, reviewed: null, error: null, changed: false };
}

/**
 * @param {ClearDialogState} state
 * @param {{ type: string, flagId?: string, reviewed?: Review, current?: Review, message?: string }} action
 * @returns {ClearDialogState}
 */
export function clearDialogReducer(state, action) {
  switch (action.type) {
    case "open":
      if (!action.flagId || !action.reviewed) return state;
      return { mode: "review", flagId: action.flagId, reviewed: action.reviewed, error: null, changed: false };

    case "cancel":
      return state.mode === "saving" ? state : initialClearDialog();

    case "save":
      return state.mode === "review" ? { ...state, mode: "saving", error: null } : state;

    case "saved":
      return state.mode === "saving" ? initialClearDialog() : state;

    case "failed":
      return state.mode === "saving" ? { ...state, mode: "review", error: action.message ?? null } : state;

    case "current":
    case "changed": {
      const current = action.current;
      if (!current || state.mode === "closed" || !state.reviewed) return state;
      if (action.type === "current" && state.mode === "saving") return state;
      if (!current.openFlagIds.includes(/** @type {string} */ (state.flagId))) return initialClearDialog();
      if (action.type === "current" && !reviewChanged(state.reviewed, current)) return state;
      return { ...state, mode: "review", reviewed: current, error: null, changed: true };
    }

    default:
      return state;
  }
}
