// Date keys (yyyy-MM-dd) and local times in the demo time zone. Pure functions, no clock reads.

export const DEMO_TIME_ZONE = "Europe/Helsinki";
const DAY_MILLIS = 86_400_000;

/** @param {string} date yyyy-MM-dd */
function parseDate(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Not a yyyy-MM-dd date: ${date}`);
  const [, y, m, d] = match;
  const millis = Date.UTC(Number(y), Number(m) - 1, Number(d));
  if (new Date(millis).toISOString().slice(0, 10) !== date) throw new Error(`Not a calendar date: ${date}`);
  return millis;
}

/** @param {string} date */
export function isDateKey(date) {
  try {
    parseDate(date);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} date yyyy-MM-dd
 * @param {number} days may be negative
 * @returns {string}
 */
export function addDays(date, days) {
  return new Date(parseDate(date) + days * DAY_MILLIS).toISOString().slice(0, 10);
}

/**
 * Whole days from `from` to `to` (positive when `to` is later).
 * @param {string} from
 * @param {string} to
 */
export function daysBetween(from, to) {
  return Math.round((parseDate(to) - parseDate(from)) / DAY_MILLIS);
}

/** Saturday or Sunday. @param {string} date */
export function isWeekend(date) {
  const day = new Date(parseDate(date)).getUTCDay();
  return day === 0 || day === 6;
}

/** @param {number} millis @param {string} timeZone */
function zoneParts(millis, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(millis));
  /** @type {Record<string, number>} */
  const out = {};
  for (const part of parts) if (part.type !== "literal") out[part.type] = Number(part.value);
  return out;
}

/**
 * The calendar date of an instant in a time zone.
 * @param {number} millis
 * @param {string} [timeZone]
 * @returns {string}
 */
export function dateInZone(millis, timeZone = DEMO_TIME_ZONE) {
  const p = zoneParts(millis, timeZone);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Epoch milliseconds of a wall-clock time on a date in a time zone.
 * @param {string} date yyyy-MM-dd
 * @param {number} hour 0..23
 * @param {number} minute 0..59
 * @param {string} [timeZone]
 */
export function zonedMillis(date, hour, minute, timeZone = DEMO_TIME_ZONE) {
  const wallClock = parseDate(date) + (hour * 60 + minute) * 60_000;
  // Offset of the zone at an instant, as wall clock minus UTC.
  /** @param {number} instant */
  const offsetAt = (instant) => {
    const p = zoneParts(instant, timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
  };
  let guess = wallClock - offsetAt(wallClock);
  guess = wallClock - offsetAt(guess);
  return guess;
}
