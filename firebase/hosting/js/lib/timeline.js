// The Phase timeline's arithmetic: weeks since the end of TMS, Phases between Visits, weekly Mood
// ratings and Questionnaire points. Pure, no Firebase imports, so `node --test` can run it, and the
// Signals and Summaries sections (#12) use `phases` and `phaseOf` to select a Phase.
//
// Rules (spec #5, "Phase timeline"):
//   - Week 1 starts the day after TMS ended: days 1 to 7 after the TMS end date are week 1.
//   - Phases run from the end of TMS to the first Visit, Visit to Visit, and the last Visit to today.
//     Each Phase covers whole days, start and end included, and never overlaps the next: the Visit
//     day closes its Phase and the next Phase starts the day after. Changing or backdating a Visit
//     simply gives new boundaries, because Phases are always computed from the Visits as they are.
//   - Mood ratings stay on their 1 to 5 scale. A week with no rating is a gap (mean null), never 0.
//   - Questionnaire points carry their kind; PHQ-2 and PHQ-9 are separate series, never one line.
//   - Without a TMS end date there are no week numbers: weeks are calendar weeks from Monday.
import { addDays, dateInZone, daysBetween, isDateKey, mondayOf } from "./dates.js";
import { QUESTIONNAIRE_KINDS } from "./contract.js";

/** @typedef {"phq2" | "phq9"} QuestionnaireKind */
/** @typedef {{ id?: string, date: string, questionnaire?: QuestionnaireKind | null, score?: number | null }} VisitLike */

/**
 * @typedef {object} Phase
 * @property {number} number 1 for the first Phase
 * @property {string | null} start first day, included; null when there is no TMS end date
 * @property {string} end last day, included: the Visit that closes the Phase, or today
 * @property {{ kind: "tms_end" | "visit", date: string | null }} from what opens the Phase
 * @property {{ kind: "visit" | "today", date: string }} to what closes it
 * @property {number | null} startWeek week of `start`; null without a TMS end date
 * @property {number | null} endWeek week of `end`; null without a TMS end date
 */

/**
 * @typedef {object} WeekMood
 * @property {number | null} week week since TMS; null for a calendar week (no TMS end date)
 * @property {string} start first day of the week
 * @property {string} end last day of the week
 * @property {number | null} mean mean Mood rating, 1 to 5, or null when there was none (a gap)
 * @property {number} n how many ratings
 */

/**
 * @typedef {object} QuestionnairePoint
 * @property {string | undefined} id the Visit's id
 * @property {string} date
 * @property {number | null} week
 * @property {QuestionnaireKind} questionnaire
 * @property {number} score
 */

const SCORE_MAX = Object.freeze({ phq2: 6, phq9: 27 });

/** @param {unknown} tmsEndDate @returns {tmsEndDate is string} */
const hasTmsEnd = (tmsEndDate) => isDateKey(tmsEndDate);

/**
 * The week since the end of TMS that a date falls in. Week 1 is the 7 days after the TMS end
 * date; the TMS end day itself is week 0 and earlier days are below it.
 * @param {string} date
 * @param {string | null | undefined} tmsEndDate
 * @returns {number | null} null without a TMS end date or for an invalid date
 */
export function weekOf(date, tmsEndDate) {
  if (!hasTmsEnd(tmsEndDate) || !isDateKey(date)) return null;
  return Math.floor((daysBetween(tmsEndDate, date) - 1) / 7) + 1;
}

/**
 * The first and last day of a week since the end of TMS.
 * @param {number} week
 * @param {string} tmsEndDate
 */
export function weekRange(week, tmsEndDate) {
  return { start: addDays(tmsEndDate, (week - 1) * 7 + 1), end: addDays(tmsEndDate, week * 7) };
}

/**
 * The Patient's Phases, oldest first. Visits that are invalid, in the future, or on or before the
 * TMS end date do not make a boundary; two Visits on one day make one.
 * @param {string | null | undefined} tmsEndDate
 * @param {VisitLike[]} visits
 * @param {string} today
 * @returns {Phase[]}
 */
export function phases(tmsEndDate, visits, today) {
  const tms = hasTmsEnd(tmsEndDate) ? tmsEndDate : null;
  const dates = [
    ...new Set(
      (visits ?? [])
        .map((v) => v?.date)
        .filter((d) => isDateKey(d) && d <= today && (tms === null || d > tms)),
    ),
  ].sort();

  /** @type {Phase[]} */
  const result = [];
  /** @type {{ kind: "tms_end" | "visit", date: string | null }} */
  let from = { kind: "tms_end", date: tms };
  const push = (/** @type {Phase["to"]} */ to) => {
    const start = from.date === null ? null : addDays(from.date, 1);
    if (start !== null && start > to.date) return;
    result.push({
      number: result.length + 1,
      start,
      end: to.date,
      from,
      to,
      startWeek: start === null ? null : weekOf(start, tms),
      endWeek: weekOf(to.date, tms),
    });
  };
  for (const date of dates) {
    push({ kind: "visit", date });
    from = { kind: "visit", date };
  }
  if (from.date !== today) push({ kind: "today", date: today });
  return result;
}

/**
 * Whether a date falls in a Phase (both ends included; an open start reaches back without limit).
 * @param {string} date
 * @param {Phase} phase
 */
export function inPhase(date, phase) {
  return isDateKey(date) && (phase.start === null || date >= phase.start) && date <= phase.end;
}

/**
 * The Phase a date falls in, or null (before the end of TMS, or after today).
 * @param {string} date
 * @param {Phase[]} list
 * @returns {Phase | null}
 */
export function phaseOf(date, list) {
  return list.find((phase) => inPhase(date, phase)) ?? null;
}

/** @param {unknown} mood @returns {mood is number} */
const isRating = (mood) => Number.isInteger(mood) && /** @type {number} */ (mood) >= 1 && /** @type {number} */ (mood) <= 5;

/**
 * Weekly mean Mood rating from Check-ins, every week from week 1 to this week. Without a TMS end
 * date, calendar weeks from Monday, from the week of the first rating to this week.
 * @param {{ startedAtMillis?: number | null, mood?: number | null }[]} checkIns
 * @param {string | null | undefined} tmsEndDate
 * @param {{ today: string, timeZone?: string }} options the time zone gives each Check-in its date
 * @returns {WeekMood[]}
 */
export function moodByWeek(checkIns, tmsEndDate, { today, timeZone }) {
  const ratings = (checkIns ?? [])
    .filter((c) => typeof c?.startedAtMillis === "number" && isRating(c.mood))
    .map((c) => ({ date: dateInZone(/** @type {number} */ (c.startedAtMillis), timeZone), mood: /** @type {number} */ (c.mood) }))
    .filter((r) => r.date <= today);

  /** @type {{ week: number | null, start: string, end: string }[]} */
  let weeks = [];
  if (hasTmsEnd(tmsEndDate)) {
    const last = weekOf(today, tmsEndDate) ?? 0;
    for (let week = 1; week <= last; week++) weeks.push({ week, ...weekRange(week, tmsEndDate) });
  } else if (ratings.length) {
    const first = ratings.map((r) => r.date).sort()[0];
    for (let start = mondayOf(first); start <= today; start = addDays(start, 7)) {
      weeks.push({ week: null, start, end: addDays(start, 6) });
    }
  }

  return weeks.map(({ week, start, end }) => {
    const inWeek = ratings.filter((r) => r.date >= start && r.date <= end);
    const n = inWeek.length;
    return { week, start, end, mean: n ? inWeek.reduce((sum, r) => sum + r.mood, 0) / n : null, n };
  });
}

/**
 * The Questionnaire scores recorded at Visits, oldest first. A Visit with no score, an unknown kind
 * or a score outside its range gives no point.
 * @param {VisitLike[]} visits
 * @param {string | null | undefined} tmsEndDate
 * @returns {QuestionnairePoint[]}
 */
export function questionnairePoints(visits, tmsEndDate) {
  return (visits ?? [])
    .filter(
      (v) =>
        isDateKey(v?.date) &&
        QUESTIONNAIRE_KINDS.includes(/** @type {string} */ (v.questionnaire)) &&
        Number.isInteger(v.score) &&
        /** @type {number} */ (v.score) >= 0 &&
        /** @type {number} */ (v.score) <= SCORE_MAX[/** @type {QuestionnaireKind} */ (v.questionnaire)],
    )
    .map((v) => ({
      id: v.id,
      date: v.date,
      week: weekOf(v.date, tmsEndDate),
      questionnaire: /** @type {QuestionnaireKind} */ (v.questionnaire),
      score: /** @type {number} */ (v.score),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * The points split into one series per kind, in order of first appearance. Each series is drawn
 * on its own scale and never joined with another.
 * @param {QuestionnairePoint[]} points
 * @returns {Partial<Record<QuestionnaireKind, QuestionnairePoint[]>>}
 */
export function pointsByKind(points) {
  /** @type {Partial<Record<QuestionnaireKind, QuestionnairePoint[]>>} */
  const series = {};
  for (const point of points) (series[point.questionnaire] ??= []).push(point);
  return series;
}

/**
 * The rows of the timeline's data table: one per week, with the Phases it touches, the weekly Mood
 * rating and the Visits in it.
 * @template {VisitLike} V
 * @param {WeekMood[]} weeks
 * @param {V[]} visits
 * @param {Phase[]} phaseList
 * @returns {(WeekMood & { phases: number[], visits: V[] })[]}
 */
export function timelineRows(weeks, visits, phaseList) {
  return weeks.map((w) => ({
    week: w.week,
    start: w.start,
    end: w.end,
    phases: phaseList.filter((p) => (p.start === null || p.start <= w.end) && p.end >= w.start).map((p) => p.number),
    mean: w.mean,
    n: w.n,
    visits: (visits ?? []).filter((v) => isDateKey(v?.date) && v.date >= w.start && v.date <= w.end),
  }));
}
