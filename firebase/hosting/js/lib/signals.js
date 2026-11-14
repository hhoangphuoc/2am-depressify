// Signal trends for the Signals section of the Patient page (#12). Pure, no Firebase imports, so
// `node --test` can run it.
//
// Rules (spec #5, "Signals and Baseline"; docs/firestore-schema.md, "Baseline"):
//   - Every Signal is compared only with the same Patient's Baseline. The comparison stored on the
//     daily record is used where there is one; otherwise it is computed with js/lib/baseline.js, the
//     one copy of the rule, which the shared fixture pins.
//   - A missing day is a gap (null), never zero: no record, a null value and a non-number all count
//     as missing.
//   - Fewer than 5 valid days, in the range shown or in the 14 days before the latest value, shows
//     "insufficient Baseline" instead of a comparison.
//   - Signals with no direction (mean heart rate, calendar load) are charted and compared, but never
//     called better or worse.
//   - Time at home and movement radius are the only Signals made from location, and both are daily
//     totals: no place or coordinate exists in the data.
import { MIN_VALID_DAYS, baselineFor, baselineValues, compareWithBaseline, directionOf, oriented } from "./baseline.js";
import { addDays, isDateKey } from "./dates.js";

/** @typedef {import("./timeline.js").Phase} Phase */
/** @typedef {{ date: string, values?: Record<string, unknown>, vsBaseline?: Record<string, unknown> }} DailyLike */
/** @typedef {number | "all"} Selection a Phase number, or every day */

/**
 * @typedef {object} SeriesPoint
 * @property {string} date
 * @property {number | null} value null is a gap
 * @property {{ centre: number, spread: number, validDays: number } | null} baseline from the 14 days before
 * @property {number} baselineDays valid days in the 14 days before
 * @property {number | null} comparison distance from the Baseline in spreads, as measured
 */

/**
 * Labels and units. `decimals` is how a value is shown; `fromLocation` marks the two Signals made
 * on the phone from location samples, which never leave it.
 */
export const SIGNAL_INFO = Object.freeze({
  sleepMinutes: { label: "Sleep", unit: "minutes asleep, credited to the day of waking", fromLocation: false },
  steps: { label: "Steps", unit: "steps per day", fromLocation: false },
  meanHeartRate: { label: "Mean heart rate", unit: "beats per minute", fromLocation: false },
  restingHeartRate: { label: "Resting heart rate", unit: "beats per minute", fromLocation: false },
  hrv: { label: "Heart rate variability (HRV)", unit: "milliseconds", fromLocation: false },
  timeAtHomeMinutes: { label: "Time at home", unit: "minutes per day", fromLocation: true },
  movementRadiusKm: { label: "Movement radius", unit: "kilometres from home", fromLocation: true },
  calendarBusyMinutes: { label: "Calendar load", unit: "busy minutes per day", fromLocation: false },
  lateNightScreenMinutes: { label: "Late-night screen time", unit: "minutes between midnight and 5", fromLocation: false },
});

/** A value older than this many days before today makes the Signal stale. */
export const STALE_AFTER_DAYS = 2;

/** How far from the Baseline, in spreads, a value must be to be called more than usual. */
export const USUAL_RANGE = 1;

/** @param {unknown} value @returns {value is number} */
const isValue = (value) => typeof value === "number" && Number.isFinite(value);

/** @param {number} minutes */
function hoursAndMinutes(minutes) {
  const rounded = Math.round(minutes);
  return rounded < 60 ? `${rounded} min` : `${Math.floor(rounded / 60)} h ${rounded % 60} min`;
}

/**
 * A value with its unit. A missing value says so; it is never shown as 0.
 * @param {string} key
 * @param {number | null | undefined} value
 */
export function formatValue(key, value) {
  if (!isValue(value)) return "No value";
  switch (key) {
    case "sleepMinutes":
    case "timeAtHomeMinutes":
      return hoursAndMinutes(value);
    case "steps":
      return `${Math.round(value).toLocaleString("en-GB")} steps`;
    case "meanHeartRate":
    case "restingHeartRate":
      return `${Math.round(value)} bpm`;
    case "hrv":
      return `${Math.round(value)} ms`;
    case "movementRadiusKm":
      return `${(Math.round(value * 10) / 10).toFixed(1)} km`;
    default:
      return `${Math.round(value)} min`;
  }
}

/** @param {unknown} source */
export function sourceLabel(source) {
  if (source === "synthetic") return "Synthetic demo data";
  if (source === "device") return "Device data from the Patient's phone";
  return "Source unknown";
}

/**
 * The Phase shown when the section opens: the current (latest) one, or all days without Phases.
 * @param {Phase[]} phaseList
 * @returns {Selection}
 */
export function defaultSelection(phaseList) {
  return phaseList.length ? phaseList[phaseList.length - 1].number : "all";
}

/**
 * The oldest daily record, never after today.
 * @param {DailyLike[]} docs
 * @param {string} today
 */
export function firstDataDate(docs, today) {
  const dates = (docs ?? []).map((d) => d?.date).filter((d) => isDateKey(d) && d <= today).sort();
  return dates[0] ?? null;
}

/**
 * The days a selection covers, both ends included. A Phase without a start (no TMS end date) and
 * "all" start at the first daily record.
 * @param {Selection} selection
 * @param {Phase[]} phaseList
 * @param {{ firstDate: string | null, today: string }} options
 * @returns {{ start: string, end: string }}
 */
export function signalWindow(selection, phaseList, { firstDate, today }) {
  const phase = selection === "all" ? undefined : phaseList.find((p) => p.number === selection);
  const end = phase ? phase.end : today;
  const start = phase?.start ?? firstDate ?? end;
  return { start: start <= end ? start : end, end };
}

/**
 * One point per calendar day from `start` to `end`, with gaps kept as null. The Baseline and the
 * comparison look at every record, so the first days of a Phase are compared with the days before.
 * @param {DailyLike[]} docs every daily record of the Patient, any order
 * @param {string} key a Signal key
 * @param {{ start: string, end: string }} window
 * @returns {SeriesPoint[]}
 */
export function signalSeries(docs, key, { start, end }) {
  /** @type {Map<string, DailyLike>} */
  const byDate = new Map();
  for (const doc of docs ?? []) if (isDateKey(doc?.date)) byDate.set(doc.date, doc);
  const history = [...byDate.values()].map((d) => ({ date: d.date, value: valueOf(d, key) }));

  /** @type {SeriesPoint[]} */
  const series = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const doc = byDate.get(date);
    const value = doc ? valueOf(doc, key) : null;
    const baseline = baselineFor(history, date);
    let comparison = null;
    if (value !== null) {
      const stored = doc?.vsBaseline;
      const hasStored = stored !== null && typeof stored === "object" && key in stored;
      comparison = hasStored ? (isValue(stored[key]) ? stored[key] : null) : compareWithBaseline(history, { date, value });
    }
    series.push({ date, value, baseline, baselineDays: baselineValues(history, date).length, comparison });
  }
  return series;
}

/** @param {DailyLike} doc @param {string} key @returns {number | null} */
function valueOf(doc, key) {
  const value = doc?.values?.[key];
  return isValue(value) ? value : null;
}

/**
 * Words for a comparison. Directed Signals are better or worse than usual; Signals with no
 * direction are only higher or lower. Within one spread of the Baseline is the usual range.
 * @param {string} key
 * @param {number | null} comparison
 * @returns {string | null}
 */
export function comparisonWord(key, comparison) {
  if (!isValue(comparison)) return null;
  const facing = oriented(key, comparison);
  if (facing === null) {
    if (comparison >= USUAL_RANGE) return "higher than usual";
    if (comparison <= -USUAL_RANGE) return "lower than usual";
    return "within the usual range";
  }
  if (facing >= USUAL_RANGE) return "better than usual";
  if (facing <= -USUAL_RANGE) return "worse than usual";
  return "within the usual range";
}

/**
 * @typedef {object} SignalSummary
 * @property {number} days calendar days in the range
 * @property {number} validDays days with a value
 * @property {SeriesPoint | null} latest the latest day with a value
 * @property {"no_values" | "insufficient_baseline" | "compared"} status
 * @property {"range" | "baseline" | null} reason why the Baseline is insufficient
 * @property {number | null} comparison the latest day's comparison, as measured
 * @property {number | null} oriented negative is worse; null for Signals with no direction
 * @property {string | null} word
 */

/**
 * What a trend says about the range it shows: how many valid days, and the latest day's comparison
 * with the Baseline, or why there is none.
 * @param {SeriesPoint[]} series
 * @param {string} key
 * @returns {SignalSummary}
 */
export function signalSummary(series, key) {
  const valid = series.filter((p) => p.value !== null);
  const latest = valid.at(-1) ?? null;
  const base = { days: series.length, validDays: valid.length, latest, comparison: null, oriented: null, word: null };
  if (!latest) return { ...base, status: "no_values", reason: null };
  if (valid.length < MIN_VALID_DAYS) return { ...base, status: "insufficient_baseline", reason: "range" };
  if (latest.comparison === null) return { ...base, status: "insufficient_baseline", reason: "baseline" };
  return {
    ...base,
    status: "compared",
    reason: null,
    comparison: latest.comparison,
    oriented: oriented(key, latest.comparison),
    word: comparisonWord(key, latest.comparison),
  };
}

/**
 * The latest date with a value for a Signal, never after today.
 * @param {DailyLike[]} docs
 * @param {string} key
 * @param {string} today
 */
export function lastValueDate(docs, key, today) {
  const dates = (docs ?? [])
    .filter((d) => isDateKey(d?.date) && d.date <= today && valueOf(d, key) !== null)
    .map((d) => d.date)
    .sort();
  return dates.at(-1) ?? null;
}

/**
 * Whether a Signal can be shown at all. Without Consent nothing is shown, even if old values
 * remain; with Consent and no value ever there is no source data; a latest value more than
 * STALE_AFTER_DAYS old is stale.
 * @param {{ consent: { granted?: unknown } | null | undefined, docs: DailyLike[], key: string, today: string }} input
 * @returns {"no_consent" | "no_data" | "stale" | "ok"}
 */
export function signalState({ consent, docs, key, today }) {
  if (consent?.granted !== true) return "no_consent";
  const last = lastValueDate(docs, key, today);
  if (last === null) return "no_data";
  return last < addDays(today, -STALE_AFTER_DAYS) ? "stale" : "ok";
}

/** @param {string} key */
export function hasDirection(key) {
  const direction = directionOf(key);
  return direction !== undefined && direction !== "none";
}
