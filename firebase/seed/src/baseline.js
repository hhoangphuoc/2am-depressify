// The Baseline comparison, as defined in docs/firestore-schema.md ("Baseline") and pinned by the
// shared fixture fixtures/baseline/baseline-cases.json, which the Kotlin Baseline tests in core also
// read. Do not change this rule here alone: change the fixture, core and this file together.
import { SIGNALS } from "../../hosting/js/lib/contract.js";

/** @typedef {import("../../functions/src/types.ts").SignalKey} SignalKey */
/** @typedef {import("../../functions/src/types.ts").SignalDirection} SignalDirection */
/** @typedef {Record<SignalKey, number | null>} SignalMap */
/** @typedef {{ date: string, value: number | null }} DatedValue */

export const WINDOW_DAYS = 14;
export const MIN_VALID_DAYS = 5;
export const SPREAD_FLOOR_FRACTION = 0.05;
export const SPREAD_FLOOR_ABSOLUTE = 0.001;

/** Every Signal key, in contract order. */
export const SIGNAL_KEYS = /** @type {SignalKey[]} */ (SIGNALS.map((s) => s.key));

/** @type {Record<string, SignalDirection>} */
const DIRECTIONS = Object.fromEntries(SIGNALS.map((s) => [s.key, /** @type {SignalDirection} */ (s.direction)]));

/** @param {string} date */
function dayNumber(date) {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/** @param {number[]} values non-empty */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Sample standard deviation (n - 1). @param {number[]} values at least two */
function sampleSd(values) {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const squares = values.reduce((sum, v) => sum + (v - mean) ** 2, 0);
  return Math.sqrt(squares / (values.length - 1));
}

/**
 * The Patient's Baseline for one Signal on a date: the median of the valid values on the 14
 * calendar dates strictly before it, and the spread (with its floor). Null with fewer than 5.
 * @param {DatedValue[]} history any order; dates outside the window are ignored
 * @param {string} date
 * @returns {{ centre: number, spread: number } | null}
 */
export function baselineFor(history, date) {
  const todayNumber = dayNumber(date);
  const valid = history
    .filter((day) => {
      const age = todayNumber - dayNumber(day.date);
      return age >= 1 && age <= WINDOW_DAYS && typeof day.value === "number";
    })
    .map((day) => /** @type {number} */ (day.value));
  if (valid.length < MIN_VALID_DAYS) return null;
  const centre = median(valid);
  const spread = Math.max(sampleSd(valid), SPREAD_FLOOR_FRACTION * Math.abs(centre), SPREAD_FLOOR_ABSOLUTE);
  return { centre, spread };
}

/**
 * Today's distance from the Patient's own Baseline for one Signal, in units of their spread.
 * @param {DatedValue[]} history any order; dates outside the window are ignored
 * @param {DatedValue} today
 * @returns {number | null} null with fewer than 5 valid days or a null today
 */
export function compareWithBaseline(history, today) {
  if (today.value === null || today.value === undefined) return null;
  const baseline = baselineFor(history, today.date);
  return baseline === null ? null : (today.value - baseline.centre) / baseline.spread;
}

/**
 * Negates lower-is-better Signals so that negative always means worse. Null for no direction.
 * @param {SignalKey} key
 * @param {number | null} comparison
 * @returns {number | null}
 */
export function oriented(key, comparison) {
  const direction = DIRECTIONS[key];
  if (comparison === null || direction === undefined || direction === "none") return null;
  return direction === "lower_is_better" ? -comparison : comparison;
}

/**
 * Mean of the oriented comparisons that exist; null if none.
 * @param {Partial<Record<SignalKey, number | null>>} vsBaseline
 * @returns {number | null}
 */
export function composite(vsBaseline) {
  const values = SIGNAL_KEYS.map((key) => oriented(key, vsBaseline[key] ?? null)).filter((v) => v !== null);
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

/**
 * Comparisons for each day of a series, each against the days before it.
 * @param {{ date: string, values: SignalMap }[]} days oldest first
 * @returns {{ vsBaseline: SignalMap, composite: number | null }[]}
 */
export function dailyComparisons(days) {
  return days.map((day) => {
    const vsBaseline = /** @type {SignalMap} */ ({});
    for (const key of SIGNAL_KEYS) {
      const history = days.map((d) => ({ date: d.date, value: d.values[key] }));
      vsBaseline[key] = compareWithBaseline(history, { date: day.date, value: day.values[key] });
    }
    return { vsBaseline, composite: composite(vsBaseline) };
  });
}
