// Flag detail on the Patient page: the level word, each reason as a plain sentence, where it came
// from and when, and the history of cleared flags. Pure, so `node --test` can run it. Never a
// number that reads as a score (ADR 0009).
import { isOpen } from "./banner.js";
import { levelWord } from "./list-row.js";
import { levelRank } from "./sort.js";

/** Where each kind of flag is raised (the spec's Attention flag table). */
const SOURCES = Object.freeze({
  crisis: "Raised during a Check-in",
  decline: "From the review after a Check-in",
  unassessed: "From the review after a Check-in",
  sleep_collapse: "From the phone's daily check",
  inactive: "From the phone's daily check",
  poor_sleep: "From the phone's daily check",
  low_mood: "From the phone's daily check",
  drift: "From the phone's daily check",
  silent: "From the hourly check for a quiet phone",
});

/** @param {string | undefined} kind */
export function flagSource(kind) {
  return kind !== undefined && Object.hasOwn(SOURCES, kind) ? SOURCES[/** @type {keyof SOURCES} */ (kind)] : "Source not recorded";
}

/**
 * The note shown beside the level when the automatic review of the latest reviewed Check-in failed
 * (`assessment: "unavailable"`, #20): the level shown is the last known one, never a new green.
 * Check-ins with no review (`assessment` null, nothing was said) are skipped. Null: nothing to say.
 * @param {{ startedAtMillis?: unknown, assessment?: unknown }[] | null | undefined} checkIns
 */
export function assessmentNote(checkIns) {
  const [latest] = (checkIns ?? [])
    .filter((c) => typeof c.assessment === "string" && typeof c.startedAtMillis === "number")
    .sort((a, b) => Number(b.startedAtMillis) - Number(a.startedAtMillis));
  return latest?.assessment === "unavailable"
    ? "Assessment unavailable: the latest Check-in could not be reviewed automatically. The level shown is the last known one."
    : null;
}

/**
 * A reason as a plain sentence: trimmed, capitalised, ending with a full stop.
 * @param {unknown} reason
 */
export function asSentence(reason) {
  const text = typeof reason === "string" ? reason.trim() : "";
  if (!text) return "No reason recorded.";
  const capital = text[0].toLocaleUpperCase("en") + text.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

/**
 * @param {number | null | undefined} millis
 * @param {string} [timeZone] defaults to the browser's
 */
export function flagTimeText(millis, timeZone) {
  if (typeof millis !== "number") return "Time not recorded";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(millis);
}

/**
 * @typedef {object} FlagLine
 * @property {string} id
 * @property {"red" | "amber" | "green"} level
 * @property {string} levelWord
 * @property {string} reason
 * @property {string} source
 * @property {string} raised
 * @property {string | null} cleared
 */

/**
 * @param {{ id: string, level?: string, kind?: string, reason?: string, raisedAtMillis?: number, clearedAtMillis?: number | null }[]} flags
 * @param {{ timeZone?: string }} [options]
 * @returns {{ open: FlagLine[], history: FlagLine[] }}
 */
export function flagDetailModel(flags, { timeZone } = {}) {
  /** @param {(typeof flags)[number]} f @returns {FlagLine} */
  const line = (f) => {
    const word = levelWord(f.level);
    return {
      id: f.id,
      level: /** @type {FlagLine["level"]} */ (word.toLowerCase()),
      levelWord: word,
      reason: asSentence(f.reason),
      source: flagSource(f.kind),
      raised: `Raised ${flagTimeText(f.raisedAtMillis, timeZone)}`,
      cleared: isOpen(f) ? null : `Cleared ${flagTimeText(f.clearedAtMillis, timeZone)}`,
    };
  };
  const time = (/** @type {unknown} */ m) => (typeof m === "number" ? m : 0);
  const open = flags
    .filter(isOpen)
    .sort((a, b) => levelRank(a.level) - levelRank(b.level) || time(b.raisedAtMillis) - time(a.raisedAtMillis));
  const history = flags.filter((f) => !isOpen(f)).sort((a, b) => time(b.clearedAtMillis) - time(a.clearedAtMillis));
  return { open: open.map(line), history: history.map(line) };
}
