// Date keys (yyyy-MM-dd) for the dashboard. Pure, no clock reads, so `node --test` can run them.
// Dates are calendar days: arithmetic runs on UTC midnights, so summer time never shifts a day.

const DAY_MILLIS = 86_400_000;
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** @param {unknown} date @returns {number | null} UTC midnight of the date, or null */
function parse(date) {
  if (typeof date !== "string") return null;
  const match = DATE_KEY.exec(date);
  if (!match) return null;
  const millis = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(millis).toISOString().slice(0, 10) === date ? millis : null;
}

/** @param {number} millis */
const keyOf = (millis) => new Date(millis).toISOString().slice(0, 10);

/**
 * True for a real calendar date written yyyy-MM-dd.
 * @param {unknown} date
 * @returns {date is string}
 */
export function isDateKey(date) {
  return parse(date) !== null;
}

/**
 * @param {string} date yyyy-MM-dd
 * @param {number} days may be negative
 * @returns {string}
 */
export function addDays(date, days) {
  const millis = parse(date);
  if (millis === null) throw new Error(`Not a yyyy-MM-dd date: ${date}`);
  return keyOf(millis + days * DAY_MILLIS);
}

/**
 * Whole days from `from` to `to`, positive when `to` is later.
 * @param {string} from
 * @param {string} to
 */
export function daysBetween(from, to) {
  const a = parse(from);
  const b = parse(to);
  if (a === null || b === null) throw new Error(`Not a yyyy-MM-dd date: ${a === null ? from : to}`);
  return Math.round((b - a) / DAY_MILLIS);
}

/**
 * The Monday of the date's week.
 * @param {string} date
 */
export function mondayOf(date) {
  const millis = parse(date);
  if (millis === null) throw new Error(`Not a yyyy-MM-dd date: ${date}`);
  const weekday = (new Date(millis).getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  return keyOf(millis - weekday * DAY_MILLIS);
}

/**
 * The calendar date of an instant in a time zone (the browser's when not given).
 * @param {number} millis
 * @param {string} [timeZone]
 * @returns {string}
 */
export function dateInZone(millis, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(millis);
}

/**
 * A short readable date, such as "24 Oct" or "24 Oct 2025" in another year than `today`.
 * @param {string} date
 * @param {string} [today]
 */
export function shortDate(date, today) {
  const millis = parse(date);
  if (millis === null) return String(date ?? "");
  const sameYear = !today || today.slice(0, 4) === date.slice(0, 4);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(millis);
}
