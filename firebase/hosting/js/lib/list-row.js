// Formatting one row of the Patient list. Pure, so `node --test` can run it.
//
// A row shows who the Patient is, the Attention flag level as a word with its reasons, the latest
// Check-in and how fresh their data is. It never shows a number that reads as a score: no
// composite, no Outcome score, no comparison with Baseline.
import { shownAttention } from "./clear.js";
import { sortPatients } from "./sort.js";

/**
 * @typedef {object} ListRow
 * @property {string} id
 * @property {string} displayName
 * @property {"red" | "amber" | "green"} flagLevel
 * @property {string} levelWord
 * @property {string[]} reasons
 * @property {string} latestCheckIn
 * @property {string} freshness
 * @property {boolean} stale true when the data is a day old or missing
 */

/** @typedef {{ nowMillis: number, timeZone?: string }} Clock */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LEVEL_WORDS = Object.freeze({ red: "Red", amber: "Amber", green: "Green" });

/** @param {unknown} level @returns {"red" | "amber" | "green"} */
function knownLevel(level) {
  return level === "red" || level === "amber" ? level : "green";
}

/** @param {string | undefined} level */
export function levelWord(level) {
  return LEVEL_WORDS[knownLevel(level)];
}

/** @param {number} n @param {string} one @param {string} many */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** yyyy-MM-dd of an instant in a time zone. @param {number} millis @param {string | undefined} timeZone */
function dayKey(millis, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(millis);
}

/** Calendar days from `then` to `now` in the time zone. @param {number} then @param {number} now @param {string | undefined} timeZone */
function calendarDaysBetween(then, now, timeZone) {
  return Math.round((Date.parse(dayKey(now, timeZone)) - Date.parse(dayKey(then, timeZone))) / DAY);
}

/**
 * @param {number | null | undefined} lastCheckInAtMillis
 * @param {number} nowMillis
 * @param {string} [timeZone] defaults to the browser's
 */
export function latestCheckInText(lastCheckInAtMillis, nowMillis, timeZone) {
  if (typeof lastCheckInAtMillis !== "number") return "No Check-in yet";
  const days = Math.max(0, calendarDaysBetween(lastCheckInAtMillis, nowMillis, timeZone));
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    lastCheckInAtMillis,
  );
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  if (days < 7) return `${days} days ago`;
  const sameYear = dayKey(lastCheckInAtMillis, timeZone).slice(0, 4) === dayKey(nowMillis, timeZone).slice(0, 4);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(lastCheckInAtMillis);
}

/**
 * How fresh the Patient's data is, from the phone's last sign of life. Stale after a day.
 * @param {number | null | undefined} lastSeenAtMillis
 * @param {number} nowMillis
 * @returns {{ text: string, stale: boolean }}
 */
export function freshness(lastSeenAtMillis, nowMillis) {
  if (typeof lastSeenAtMillis !== "number") return { text: "No data yet", stale: true };
  const age = Math.max(0, nowMillis - lastSeenAtMillis);
  if (age < HOUR) return { text: "Updated in the last hour", stale: false };
  if (age < DAY) return { text: `Updated ${plural(Math.floor(age / HOUR), "hour", "hours")} ago`, stale: false };
  return { text: `No data for ${plural(Math.floor(age / DAY), "day", "days")}`, stale: true };
}

/**
 * @param {{ id: string, data: Partial<import("./contract.js").PatientDoc> }} doc
 * @param {Clock} clock
 * @param {import("./clear.js").FlagRecord[]} [flags] the Patient's visible flags, once loaded: the
 *   level and reasons then come from the open ones (`shownAttention`), else from the record
 * @returns {ListRow}
 */
export function toListRow({ id, data }, { nowMillis, timeZone }, flags) {
  const shown = shownAttention(data, flags);
  const flagLevel = knownLevel(shown.flagLevel);
  const given = shown.flagReasons;
  const reasons = given.length ? given : [flagLevel === "green" ? "Nothing raised." : "No reason recorded."];
  const fresh = freshness(data.lastSeenAtMillis, nowMillis);
  return {
    id,
    displayName: data.displayName || "Unnamed patient",
    flagLevel,
    levelWord: LEVEL_WORDS[flagLevel],
    reasons,
    latestCheckIn: latestCheckInText(data.lastCheckInAtMillis, nowMillis, timeZone),
    freshness: fresh.text,
    stale: fresh.stale,
  };
}

/**
 * The whole list: rows sorted red, amber, green, then newest open flag, then name.
 * @param {{ id: string, data: Partial<import("./contract.js").PatientDoc> }[]} docs
 * @param {Record<string, number | null | undefined>} latestFlagAtById
 * @param {Clock} clock
 * @param {Record<string, import("./clear.js").FlagRecord[] | undefined>} [flagsById] each Patient's
 *   visible flags, where loaded
 * @returns {ListRow[]}
 */
export function patientListRows(docs, latestFlagAtById, clock, flagsById = {}) {
  return sortPatients(
    docs.map((doc) => toListRow(doc, clock, flagsById[doc.id])),
    latestFlagAtById,
  );
}
