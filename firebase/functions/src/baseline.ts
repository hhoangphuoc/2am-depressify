// The Baseline comparison for one Signal, as defined in docs/firestore-schema.md ("Baseline") and
// pinned by the shared fixture fixtures/baseline/baseline-cases.json. The functions' copy of the
// dashboard's firebase/hosting/js/lib/baseline.js: functions are built from `src` alone, so they
// cannot import the dashboard's file. test/baseline.test.ts runs the same fixture through this one.
// Finish Check-in uses it for an Outcome's `objectiveChange` when the day's stored comparison is
// missing (#21). Do not change the rule here alone: change the fixture and every copy together.
import { SIGNALS, type SignalKey } from "./types";

export const WINDOW_DAYS = 14;
export const MIN_VALID_DAYS = 5;
export const SPREAD_FLOOR_FRACTION = 0.05;
export const SPREAD_FLOOR_ABSOLUTE = 0.001;

export interface DatedValue {
  /** yyyy-MM-dd */
  date: string;
  value: number | null | undefined;
}

const DAY_MILLIS = 86_400_000;

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MILLIS);
}

function isValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Sample standard deviation (n - 1), for at least two values. */
function sampleSd(values: number[]): number {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1));
}

/**
 * The Patient's Baseline for one Signal on `date`: the median of the valid values on the 14
 * calendar dates strictly before it, and the spread with its floor. Null with fewer than 5.
 */
export function baselineFor(history: readonly DatedValue[], date: string): { centre: number; spread: number; validDays: number } | null {
  const today = dayNumber(date);
  const valid = history
    .filter((day) => {
      const age = today - dayNumber(day.date);
      return age >= 1 && age <= WINDOW_DAYS && isValue(day.value);
    })
    .map((day) => day.value as number);
  if (valid.length < MIN_VALID_DAYS) return null;
  const centre = median(valid);
  const spread = Math.max(sampleSd(valid), SPREAD_FLOOR_FRACTION * Math.abs(centre), SPREAD_FLOOR_ABSOLUTE);
  return { centre, spread, validDays: valid.length };
}

/** Today's distance from the Patient's own Baseline, in units of their spread. Null with fewer than 5 valid days or no value today. */
export function compareWithBaseline(history: readonly DatedValue[], today: DatedValue): number | null {
  if (!isValue(today.value)) return null;
  const baseline = baselineFor(history, today.date);
  return baseline === null ? null : (today.value - baseline.centre) / baseline.spread;
}

/** Negates lower-is-better Signals so that negative always means worse. Null for a Signal with no direction. */
export function oriented(key: SignalKey | string, comparison: number | null): number | null {
  const direction = SIGNALS.find((s) => s.key === key)?.direction;
  if (comparison === null || direction === undefined || direction === "none") return null;
  return direction === "lower_is_better" ? -comparison : comparison;
}
