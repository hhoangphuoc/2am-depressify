// Checking a Visit and the TMS end date before the Clinician saves them. Pure, so `node --test`
// can run it. The security rules check the shape (a date, a known kind, an integer score); the
// dashboard checks the rest here: no future date, and a score inside its Questionnaire's range.
//
// A Visit holds only its date, Questionnaire kind and score. Questionnaire scores never feed the
// Attention flag, so recording a Visit writes nothing else.
import { isDateKey } from "./dates.js";

/** @typedef {import("./timeline.js").QuestionnaireKind} QuestionnaireKind */
/** @typedef {{ date: string, questionnaire: QuestionnaireKind | null, score: number | null }} Visit */

export const QUESTIONNAIRE_RANGES = Object.freeze({
  phq2: Object.freeze({ min: 0, max: 6 }),
  phq9: Object.freeze({ min: 0, max: 27 }),
});

const LABELS = Object.freeze({ phq2: "PHQ-2", phq9: "PHQ-9" });

/** @param {string} kind */
export function questionnaireLabel(kind) {
  return LABELS[/** @type {QuestionnaireKind} */ (kind)] ?? kind;
}

export const VISIT_COPY = Object.freeze({
  dateMissing: "Enter the date of the Visit.",
  dateFuture: "A Visit cannot be in the future.",
  kindUnknown: "Choose PHQ-2, PHQ-9 or no score.",
  scoreWhole: "The score must be a whole number.",
  scoreNeedsKind: "Choose PHQ-2 or PHQ-9 for this score.",
  /** @param {QuestionnaireKind} kind */
  scoreMissing: (kind) => `Enter the ${LABELS[kind]} score, or choose no score.`,
  /** @param {QuestionnaireKind} kind */
  scoreRange: (kind) => `A ${LABELS[kind]} score is ${QUESTIONNAIRE_RANGES[kind].min} to ${QUESTIONNAIRE_RANGES[kind].max}.`,
  tmsMissing: "Enter the date TMS ended.",
  tmsFuture: "The TMS end date cannot be in the future.",
});

/**
 * Checks the Record a Visit form.
 * @param {{ date: string, questionnaire: string | null, score: string | number | null }} input the form's
 *   values: `questionnaire` is "", "phq2" or "phq9"; `score` is the text typed
 * @param {string} today yyyy-MM-dd
 * @returns {{ ok: true, visit: Visit } | { ok: false, errors: { date?: string, questionnaire?: string, score?: string } }}
 */
export function validateVisit(input, today) {
  /** @type {{ date?: string, questionnaire?: string, score?: string }} */
  const errors = {};
  const date = String(input?.date ?? "").trim();
  if (!isDateKey(date)) errors.date = VISIT_COPY.dateMissing;
  else if (date > today) errors.date = VISIT_COPY.dateFuture;

  const kindText = String(input?.questionnaire ?? "").trim();
  const scoreText = String(input?.score ?? "").trim();
  /** @type {QuestionnaireKind | null} */
  let questionnaire = null;
  /** @type {number | null} */
  let score = null;

  if (kindText !== "" && !(kindText in QUESTIONNAIRE_RANGES)) {
    errors.questionnaire = VISIT_COPY.kindUnknown;
  } else if (kindText === "") {
    if (scoreText !== "") errors.score = VISIT_COPY.scoreNeedsKind;
  } else {
    questionnaire = /** @type {QuestionnaireKind} */ (kindText);
    const range = QUESTIONNAIRE_RANGES[questionnaire];
    if (scoreText === "") errors.score = VISIT_COPY.scoreMissing(questionnaire);
    else if (!/^-?\d+$/.test(scoreText)) errors.score = VISIT_COPY.scoreWhole;
    else {
      score = Number(scoreText);
      if (score < range.min || score > range.max) errors.score = VISIT_COPY.scoreRange(questionnaire);
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, visit: { date, questionnaire, score } };
}

/**
 * Checks the TMS end date.
 * @param {string} input
 * @param {string} today
 * @returns {{ ok: true, date: string } | { ok: false, error: string }}
 */
export function validateTmsEndDate(input, today) {
  const date = String(input ?? "").trim();
  if (!isDateKey(date)) return { ok: false, error: VISIT_COPY.tmsMissing };
  if (date > today) return { ok: false, error: VISIT_COPY.tmsFuture };
  return { ok: true, date };
}

/**
 * Newest Visit first; a Visit with an invalid date goes last.
 * @template {{ date: string }} V
 * @param {V[]} visits
 * @returns {V[]}
 */
export function sortVisits(visits) {
  const key = (/** @type {V} */ v) => (isDateKey(v.date) ? v.date : "");
  return [...visits].sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
}
