// Where the seeded Attention flags go. The phone's daily job (core's flag rules, issue #16) is the
// authority on raising flags; the seed only needs its history to look like the phone raised it, so
// it places each flag on the first morning the spec's rule (with its starred starting values)
// holds. The tests check the result against the profiles: declining ends red after amber, steady
// stays green, sparse is amber for low mood.

/** @typedef {import("../../functions/src/types.ts").FlagLevel} FlagLevel */
/** @typedef {import("../../functions/src/types.ts").FlagKind} FlagKind */

export const THRESHOLDS = Object.freeze({
  sleepCollapseMinutes: 180,
  sleepCollapseOriented: -2.5,
  poorSleepOriented: -1.0,
  driftComposite: -1.0,
  runDays: 3,
  lowMoodAtMost: 2,
});

/** Plain sentences, never a number that reads as a score. */
export const REASONS = Object.freeze({
  sleepUnder3Hours: "Slept under 3 hours last night.",
  sleepFarBelowUsual: "Slept far less than usual last night.",
  poorSleep: "Slept much less than usual on each of the last three nights.",
  drift: "Several Signals have stayed below their usual range for three days.",
  lowMood: "Rated mood low at each of the last three Check-ins.",
});

/**
 * One morning's inputs, oldest day first.
 * @typedef {object} Morning
 * @property {number | null} sleepMinutes last night's sleep (credited to this date)
 * @property {(number | null)[]} sleepOriented oriented sleep comparisons, this date last
 * @property {(number | null)[]} composites composites, this date last
 * @property {(number | null)[]} moods moods of the Check-ins before this morning, newest last
 */

/** @typedef {{ level: FlagLevel, kind: FlagKind, reason: string }} FlagDraft */

/**
 * @param {(number | null)[]} series
 * @param {number} threshold
 */
function lastRunAtOrBelow(series, threshold) {
  const run = series.slice(-THRESHOLDS.runDays);
  return run.length === THRESHOLDS.runDays && run.every((v) => v !== null && v <= threshold);
}

/**
 * The flags the daily job would draft this morning.
 * @param {Morning} m
 * @returns {FlagDraft[]}
 */
export function draftsFor(m) {
  /** @type {FlagDraft[]} */
  const drafts = [];
  const sleepToday = m.sleepOriented.at(-1) ?? null;
  if (m.sleepMinutes !== null) {
    if (m.sleepMinutes < THRESHOLDS.sleepCollapseMinutes) {
      drafts.push({ level: "red", kind: "sleep_collapse", reason: REASONS.sleepUnder3Hours });
    } else if (sleepToday !== null && sleepToday <= THRESHOLDS.sleepCollapseOriented) {
      drafts.push({ level: "red", kind: "sleep_collapse", reason: REASONS.sleepFarBelowUsual });
    }
  }
  if (lastRunAtOrBelow(m.sleepOriented, THRESHOLDS.poorSleepOriented)) {
    drafts.push({ level: "amber", kind: "poor_sleep", reason: REASONS.poorSleep });
  }
  const moods = m.moods.slice(-THRESHOLDS.runDays);
  if (moods.length === THRESHOLDS.runDays && moods.every((v) => v !== null && v <= THRESHOLDS.lowMoodAtMost)) {
    drafts.push({ level: "amber", kind: "low_mood", reason: REASONS.lowMood });
  }
  if (lastRunAtOrBelow(m.composites, THRESHOLDS.driftComposite)) {
    drafts.push({ level: "amber", kind: "drift", reason: REASONS.drift });
  }
  return drafts;
}
