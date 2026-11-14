// Summaries for the Patient page (#12): ordering, selection and what one Summary shows. Pure, no
// Firebase imports, so `node --test` can run it.
//
// The Clinician reads exactly the Summary the Patient reads (ADR 0005): ratings, the sleep line,
// themes, the Suggestion, the previous Outcome, Voice cues worded as observations and at most three
// short quotes. Only those fields are picked out, so a transcript or audio can never be shown, even
// if a document carried one.

export const MAX_QUOTES = 3;
export const MAX_QUOTE_CHARS = 200;

/** @typedef {{ label?: unknown, intensity?: unknown, heard?: unknown }} VoiceCueLike */

/**
 * @typedef {object} SummaryLike
 * @property {string} [id]
 * @property {string} [checkInId]
 * @property {number | null} [createdAtMillis]
 * @property {number | null} [mood]
 * @property {number | null} [energy]
 * @property {number | null} [sleepQuality]
 * @property {string} [sleepLine]
 * @property {unknown[]} [themes]
 * @property {VoiceCueLike[]} [voiceCues]
 * @property {string | null} [suggestion]
 * @property {string | null} [previousOutcome]
 * @property {unknown[]} [quotes]
 */

/**
 * @typedef {object} SummaryView
 * @property {string} id
 * @property {number | null} createdAtMillis
 * @property {{ name: string, text: string }[]} ratings
 * @property {string} sleepLine
 * @property {string[]} themes
 * @property {string | null} suggestion
 * @property {string | null} previousOutcome
 * @property {string[]} voiceCues
 * @property {string[]} quotes
 */

/** @param {unknown} value @returns {value is number} */
const isTime = (value) => typeof value === "number" && Number.isFinite(value);

/** @param {SummaryLike} s */
const idOf = (s) => String(s?.id ?? s?.checkInId ?? "");

/**
 * Newest first by creation time; a Summary without one goes last. Ties fall back to the id
 * (Check-in ids carry the date), newest first. Returns a new array.
 * @template {SummaryLike} T
 * @param {T[]} summaries
 * @returns {T[]}
 */
export function sortSummaries(summaries) {
  return [...(summaries ?? [])].sort((a, b) => {
    const ta = isTime(a.createdAtMillis) ? a.createdAtMillis : -Infinity;
    const tb = isTime(b.createdAtMillis) ? b.createdAtMillis : -Infinity;
    if (ta !== tb) return tb - ta;
    return idOf(b).localeCompare(idOf(a));
  });
}

/**
 * The Summary to show: the chosen one while it exists, otherwise the newest.
 * @template {SummaryLike} T
 * @param {T[]} sorted newest first
 * @param {string | null | undefined} selectedId
 * @returns {T | null}
 */
export function selectSummary(sorted, selectedId) {
  return sorted.find((s) => idOf(s) === selectedId) ?? sorted[0] ?? null;
}

/**
 * At most three quotes, each at most 200 characters, empty ones dropped first.
 * @param {unknown} quotes
 * @returns {string[]}
 */
export function shortQuotes(quotes) {
  if (!Array.isArray(quotes)) return [];
  return quotes
    .filter((q) => typeof q === "string" && q.trim())
    .slice(0, MAX_QUOTES)
    .map((q) => {
      const text = /** @type {string} */ (q).trim();
      return text.length <= MAX_QUOTE_CHARS ? text : `${text.slice(0, MAX_QUOTE_CHARS - 1).trimEnd()}…`;
    });
}

/**
 * A 1 to 5 rating, or "Not given".
 * @param {unknown} value
 */
export function ratingText(value) {
  return Number.isInteger(value) && /** @type {number} */ (value) >= 1 && /** @type {number} */ (value) <= 5 ? `${value} of 5` : "Not given";
}

/** @param {string} text */
const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * A Voice cue as an observation: what was noticed, how strongly, and what was heard.
 * @param {VoiceCueLike} cue
 */
export function voiceCueText(cue) {
  const label = typeof cue?.label === "string" && cue.label.trim() ? capitalise(cue.label.trim()) : "Voice cue";
  const intensity = Number.isInteger(cue?.intensity) && /** @type {number} */ (cue.intensity) >= 1 && /** @type {number} */ (cue.intensity) <= 5;
  const heard = typeof cue?.heard === "string" ? cue.heard.trim() : "";
  return `${label}${intensity ? `, noticed at ${cue.intensity} of 5` : ""}${heard ? `: ${heard}` : ""}`;
}

/** @param {unknown} value */
const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

/**
 * Only what a Summary shows, in display order.
 * @param {SummaryLike} summary
 * @returns {SummaryView}
 */
export function summaryView(summary) {
  return {
    id: idOf(summary),
    createdAtMillis: isTime(summary?.createdAtMillis) ? summary.createdAtMillis : null,
    ratings: [
      { name: "Mood", text: ratingText(summary?.mood) },
      { name: "Energy", text: ratingText(summary?.energy) },
      { name: "Sleep quality", text: ratingText(summary?.sleepQuality) },
    ],
    sleepLine: text(summary?.sleepLine) ?? "",
    themes: Array.isArray(summary?.themes) ? /** @type {string[]} */ (summary.themes.filter((t) => typeof t === "string" && t.trim())) : [],
    suggestion: text(summary?.suggestion),
    previousOutcome: text(summary?.previousOutcome),
    voiceCues: Array.isArray(summary?.voiceCues) ? summary.voiceCues.map(voiceCueText) : [],
    quotes: shortQuotes(summary?.quotes),
  };
}
