// The Baseline comparison, as defined in docs/firestore-schema.md ("Baseline") and pinned by the
// shared fixture fixtures/baseline/baseline-cases.json, which the Kotlin Baseline tests in core also
// read. The rule lives once, in the dashboard's firebase/hosting/js/lib/baseline.js, so the seed and
// the dashboard can never disagree; this file re-exports it with the seed's contract types.
// Do not change this rule there alone: change the fixture, core and that file together.
import * as shared from "../../hosting/js/lib/baseline.js";

/** @typedef {import("../../functions/src/types.ts").SignalKey} SignalKey */
/** @typedef {import("../../functions/src/types.ts").SignalDirection} SignalDirection */
/** @typedef {Record<SignalKey, number | null>} SignalMap */
/** @typedef {{ date: string, value: number | null }} DatedValue */

export const { WINDOW_DAYS, MIN_VALID_DAYS, SPREAD_FLOOR_FRACTION, SPREAD_FLOOR_ABSOLUTE, baselineFor, compareWithBaseline, composite } = shared;

/** Every Signal key, in contract order. */
export const SIGNAL_KEYS = /** @type {SignalKey[]} */ ([...shared.SIGNAL_KEYS]);

/** @type {(key: SignalKey, comparison: number | null) => number | null} */
export const oriented = shared.oriented;

/**
 * Comparisons for each day of a series, each against the days before it.
 * @type {(days: { date: string, values: SignalMap }[]) => { vsBaseline: SignalMap, composite: number | null }[]}
 */
export const dailyComparisons = /** @type {any} */ (shared.dailyComparisons);
