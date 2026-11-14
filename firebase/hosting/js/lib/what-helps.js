// "What seems to help" (#12): each kind of Suggestion with how often it was scored and how the
// Patient said it felt, over a stated window. Pure, no Firebase imports, so `node --test` can run it.
//
// Rules (spec #5, "Learning what helps"):
//   - Only scored Suggestions count: those with an Outcome score. Unanswered and declined ones do not.
//   - Kinds are sorted by their mean Outcome score, then by count. The mean only orders the list;
//     it is never shown. The dashboard states counts and reported feelings, with no effectiveness
//     percentage and no number that reads as a grade of the Patient.
//   - The window is the last 28 days, today included, by the day the Suggestion was made.
import { SUGGESTION_KINDS } from "./contract.js";
import { addDays, dateInZone } from "./dates.js";

export const WHAT_HELPS_WINDOW_DAYS = 28;

const KIND_LABELS = Object.freeze({
  walk: "Walk",
  nature: "Time in nature",
  music: "Music",
  social_call: "Calling someone",
  breathing: "Breathing exercise",
  class_activity: "Class or group activity",
  daylight: "Daylight",
});

/** @typedef {"better" | "same" | "notMuch" | "notTried" | "notSaid"} FeelingGroup */

/**
 * @typedef {object} WhatHelpsRow
 * @property {string} kind
 * @property {string} label
 * @property {number} n scored Suggestions of this kind in the window
 * @property {number} mean mean Outcome score; for ordering only, never shown
 * @property {Record<FeelingGroup, number>} feelings
 */

/** @param {string} kind */
export function kindLabel(kind) {
  return KIND_LABELS[/** @type {keyof typeof KIND_LABELS} */ (kind)] ?? kind;
}

/**
 * @param {string} today
 * @param {number} [days]
 * @returns {{ start: string, end: string, days: number }}
 */
export function whatHelpsWindow(today, days = WHAT_HELPS_WINDOW_DAYS) {
  return { start: addDays(today, -(days - 1)), end: today, days };
}

/**
 * The Patient's own answer, in words: 4 or 5 felt better, 3 about the same, 1 or 2 not much help.
 * @param {{ tried?: unknown, felt?: unknown }} suggestion
 * @returns {FeelingGroup}
 */
export function feelingGroup({ tried, felt }) {
  if (tried === false) return "notTried";
  if (!Number.isInteger(felt)) return "notSaid";
  const f = /** @type {number} */ (felt);
  return f >= 4 ? "better" : f === 3 ? "same" : "notMuch";
}

/** @param {unknown} value @returns {value is number} */
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

/**
 * @param {{ kind?: unknown, suggestedAtMillis?: unknown, status?: unknown, tried?: unknown, felt?: unknown, outcomeScore?: unknown }[]} suggestions
 * @param {{ start: string, end: string, timeZone?: string }} window
 * @returns {{ rows: WhatHelpsRow[], waiting: number }} `waiting`: accepted in the window, no Outcome yet
 */
export function whatHelps(suggestions, { start, end, timeZone }) {
  /** @type {Map<string, { scores: number[], feelings: Record<FeelingGroup, number> }>} */
  const byKind = new Map();
  let waiting = 0;
  for (const s of suggestions ?? []) {
    if (!SUGGESTION_KINDS.includes(/** @type {string} */ (s?.kind)) || !isNumber(s.suggestedAtMillis)) continue;
    const date = dateInZone(s.suggestedAtMillis, timeZone);
    if (date < start || date > end) continue;
    if (!isNumber(s.outcomeScore)) {
      if (s.status === "accepted") waiting++;
      continue;
    }
    const kind = /** @type {string} */ (s.kind);
    if (!byKind.has(kind)) byKind.set(kind, { scores: [], feelings: { better: 0, same: 0, notMuch: 0, notTried: 0, notSaid: 0 } });
    const entry = /** @type {{ scores: number[], feelings: Record<FeelingGroup, number> }} */ (byKind.get(kind));
    entry.scores.push(s.outcomeScore);
    entry.feelings[feelingGroup(s)]++;
  }
  const rows = [...byKind.entries()].map(([kind, { scores, feelings }]) => ({
    kind,
    label: kindLabel(kind),
    n: scores.length,
    mean: scores.reduce((sum, v) => sum + v, 0) / scores.length,
    feelings,
  }));
  rows.sort((a, b) => b.mean - a.mean || b.n - a.n || a.kind.localeCompare(b.kind));
  return { rows, waiting };
}
