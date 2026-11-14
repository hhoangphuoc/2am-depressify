// Small pure view models for the dashboard's design-system layout (design/clinician): the workspace
// date line, the connection freshness, the roster's filter labels and counts, the Patient header's
// meta line, the 14-day sleep sparkline, the Phase strip above the timeline lanes and the lanes'
// date ticks. No DOM, no Firebase, no clock reads, so `node --test` runs them.
import { baselineFor } from "./baseline.js";
import { addDays, daysBetween, isDateKey, shortDate } from "./dates.js";
import { DESIGN_LEVELS, rosterView } from "./design-model.js";
import { weekOf } from "./timeline.js";

/** The roster's filter buttons, in the design's words. */
export const FILTER_LABELS = Object.freeze({
  all: "All",
  red: "Red",
  amber: "Amber",
  unknown: "Unassessed",
  green: "Green",
  hidden: "Withdrawn",
});

/**
 * The place a time zone names, for the workspace line: "Europe/Helsinki" → "Helsinki".
 * @param {string} timeZone
 */
export function placeOf(timeZone) {
  const last = String(timeZone ?? "").split("/").at(-1) ?? "";
  return last.replaceAll("_", " ") || "Local time";
}

/**
 * The line above every page: "Friday, 13 November 2026" and "Helsinki · 14:20".
 * @param {number} nowMillis
 * @param {string} timeZone
 */
export function workspaceMeta(nowMillis, timeZone) {
  const date = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(nowMillis);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(nowMillis);
  return { date: date.replace(/^(\w+) /, "$1, "), time: `${placeOf(timeZone)} · ${time}` };
}

/**
 * The roster's connection freshness: live with the time of the last update, or the SDK's saved copy.
 * @param {{ status: string, fromCache: boolean, updatedAtMillis?: number | null }} roster
 * @param {string} timeZone
 * @returns {{ text: string, offline: boolean }}
 */
export function connectionText({ status, fromCache, updatedAtMillis }, timeZone) {
  if (status === "loading") return { text: "Connecting…", offline: false };
  if (status !== "ok") return { text: "Not connected", offline: true };
  const time =
    typeof updatedAtMillis === "number"
      ? new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(updatedAtMillis)
      : null;
  if (fromCache) return { text: time ? `Saved view · ${time}` : "Saved view", offline: true };
  return { text: time ? `Live · updated ${time}` : "Live", offline: false };
}

/**
 * The line under the roster: "2 of 3 Patients · ordered by Attention flag".
 * @param {number} shown @param {number} total
 */
export function rosterCountText(shown, total) {
  return `${shown} of ${total} ${total === 1 ? "Patient" : "Patients"} · ordered by Attention flag`;
}

/**
 * The Patient header's meta line, as parts joined by a separator: the week since TMS (or that the
 * date is missing) and whether this is a Demo Patient.
 * @param {{ tmsEndDate?: string | null, synthetic?: boolean }} patient
 * @param {string} today
 * @returns {string[]}
 */
export function patientMeta(patient, today) {
  const tms = isDateKey(patient?.tmsEndDate) ? patient.tmsEndDate : null;
  const week = tms ? weekOf(today, tms) : null;
  const parts = [tms ? (week !== null && week >= 1 ? `Week ${week} since TMS` : `TMS ended ${shortDate(tms, today)}`) : "TMS end date not recorded"];
  if (patient?.synthetic === true) parts.push("Demo Patient");
  return parts;
}

/**
 * @typedef {object} SparklineModel
 * @property {number} width
 * @property {number} height
 * @property {[number, number][][]} segments runs of neighbouring days that have a value
 * @property {{ x: number, width: number }[]} gaps days without a value (hatched)
 * @property {number | null} baselineY the Patient's own Baseline on the last day, or null
 * @property {{ x: number, y: number } | null} last the last day's value
 * @property {string} label the text alternative
 */

/**
 * The roster's sleep sparkline (`Sparkline` in design/clinician/src/Charts.jsx): the last `days`
 * days, hatched where there is no value, with the Patient's own Baseline (median of the 14 days
 * before the last day, at least 5 valid days; js/lib/baseline.js) as a dashed line. Null when no
 * day has a value.
 * @param {{ date: string, [key: string]: unknown }[]} rows oldest first, one per day (missing = null)
 * @param {{ key?: string, days?: number, width?: number, height?: number, unit?: string, label?: string }} [options]
 * @returns {SparklineModel | null}
 */
export function sparkline(rows, { key = "sleep", days = 14, width = 120, height = 32, unit = "h", label = "Sleep" } = {}) {
  const all = Array.isArray(rows) ? rows : [];
  const recent = all.slice(-days);
  const value = (/** @type {any} */ row) => (typeof row?.[key] === "number" && Number.isFinite(row[key]) ? /** @type {number} */ (row[key]) : null);
  const values = recent.map(value).filter((v) => v !== null);
  if (!recent.length || !values.length) return null;
  const lastDate = recent.at(-1).date;
  const own = isDateKey(lastDate) ? baselineFor(all.map((r) => ({ date: r.date, value: value(r) })), lastDate) : null;
  const pad = 3;
  const step = width / days;
  const span = [...values, ...(own ? [own.centre] : [])];
  const lo = Math.min(...span) - 0.3;
  const hi = Math.max(...span) + 0.3;
  const y = (/** @type {number} */ v) => round(height - pad - ((v - lo) / (hi - lo)) * (height - pad * 2));
  // Right-align: the last day sits at the right edge even with fewer rows than `days`.
  const offset = days - recent.length;
  const xOf = (/** @type {number} */ i) => round((offset + i) * step + step / 2);
  /** @type {[number, number][][]} */
  const segments = [];
  /** @type {[number, number][]} */
  let current = [];
  /** @type {{ x: number, width: number }[]} */
  const gaps = [];
  recent.forEach((row, i) => {
    const v = value(row);
    if (v === null) {
      gaps.push({ x: round((offset + i) * step), width: round(step) });
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push([xOf(i), y(v)]);
    }
  });
  if (current.length) segments.push(current);
  const lastValue = value(recent.at(-1));
  const fmt = (/** @type {number} */ v) => `${(Math.round(v * 10) / 10).toFixed(1)} ${unit}`;
  const missing = recent.length - values.length;
  const text =
    `${label}, last ${days} days. Latest ${lastValue === null ? "no data" : fmt(lastValue)}` +
    (own ? `, Baseline ${fmt(own.centre)}` : "") +
    (missing ? `, ${missing} ${missing === 1 ? "day" : "days"} without data` : "") +
    ".";
  return {
    width,
    height,
    segments,
    gaps,
    baselineY: own ? y(own.centre) : null,
    last: lastValue === null ? null : { x: xOf(recent.length - 1), y: y(lastValue) },
    label: text,
  };
}

/** @param {number} n */
const round = (n) => Math.round(n * 10) / 10;

/**
 * The date axis the timeline lanes share: day 0 is `origin`, and day `d` covers the date
 * `origin + d` (so a date's centre is at `d - 0.5`), to `span` days.
 * @typedef {{ origin: string, span: number }} Axis
 */

/**
 * The Phase strip above the lanes (`phase-strip` in the design): one segment per Phase, sized by
 * its days on the axis, with its dates. Leading days before the first Phase start get an unlabelled
 * spacer, so the strip lines up with the lanes.
 * @param {import("./timeline.js").Phase[]} phaseList
 * @param {Axis & { today: string }} axis
 * @returns {{ label: string, short: string, from: string | null, to: string, days: number, dates: string, spacer: boolean }[]}
 */
export function phaseStrip(phaseList, { origin, span, today }) {
  const day = (/** @type {string} */ date) => daysBetween(origin, date);
  const out = [];
  let cursor = 0;
  for (const phase of phaseList ?? []) {
    const from = Math.max(0, phase.start ? day(phase.start) - 1 : 0);
    const to = Math.min(span, day(phase.end));
    if (to <= from) continue;
    if (from > cursor) out.push({ label: "", short: "", from: null, to: phase.start ?? phase.end, days: from - cursor, dates: "", spacer: true });
    const start = phase.start ?? addDays(origin, from + 1);
    out.push({
      label: `Phase ${phase.number}`,
      short: String(phase.number),
      from: start,
      to: phase.end,
      days: to - from,
      dates: `${shortDate(start, today)} – ${shortDate(phase.end, today)}`,
      spacer: false,
    });
    cursor = to;
  }
  return out;
}

/**
 * The date ticks under a lane: weekly, anchored on today so the right edge is always labelled, and
 * thinned so labels never collide at phone width (at least ~56 px apart). `at` is the date's centre
 * on the axis (day `d` covers the date `origin + d`).
 * @param {Axis & { today: string, plotWidth: number }} axis
 * @returns {{ at: number, date: string, label: string }[]}
 */
export function laneTicks({ origin, span, today, plotWidth }) {
  const weeks = Math.max(1, Math.ceil(span / 7));
  const perWeek = plotWidth / weeks;
  const step = perWeek >= 56 ? 1 : perWeek >= 28 ? 2 : perWeek >= 14 ? 4 : 8;
  const ticks = [];
  for (let k = 0; ; k += step) {
    const date = addDays(today, -7 * k);
    const day = daysBetween(origin, date);
    if (day < 1) break;
    if (day <= span) ticks.push({ at: day - 0.5, date, label: shortDate(date, today) });
  }
  return ticks.reverse();
}

// ---------------------------------------------------------------------------------------------
// The Attention band
// ---------------------------------------------------------------------------------------------

export const ATTENTION_COPY = Object.freeze({
  flagsFailed: "Could not load the flags. The level shown is the one saved on the Patient's record. Reload the page to try again.",
  notLoaded: "Attention flag not loaded",
});

/**
 * What the Attention band shows for a design patient object (`designPatient`). When the flags
 * could not be loaded (`flagsError`), the record's stored level stands in with a notice, nothing
 * can be cleared, and the band is never green: a stored green shows as "not loaded" instead.
 * @param {{ level: string, levelWord?: string, flagsLoaded?: boolean, flagsError?: boolean }} patient
 * @returns {{ level: string, word: string, notice: string | null, clearable: boolean }}
 */
export function attentionBand(patient) {
  const word = patient.levelWord ?? DESIGN_LEVELS[/** @type {keyof typeof DESIGN_LEVELS} */ (patient.level)] ?? patient.level;
  if (patient.flagsError === true) {
    if (patient.level === "green") return { level: "unknown", word: ATTENTION_COPY.notLoaded, notice: ATTENTION_COPY.flagsFailed, clearable: false };
    return { level: patient.level, word, notice: ATTENTION_COPY.flagsFailed, clearable: false };
  }
  return { level: patient.level, word, notice: null, clearable: patient.flagsLoaded === true };
}

// ---------------------------------------------------------------------------------------------
// Charts in tabs
// ---------------------------------------------------------------------------------------------

/**
 * Whether to draw a chart at `width`, and the width to remember. A hidden tab has no width: nothing
 * is drawn and the width is forgotten (0), so showing the tab again counts as a resize.
 * @param {number} width
 * @returns {{ draw: boolean, drawnWidth: number }}
 */
export function chartDrawPlan(width) {
  return width > 0 ? { draw: true, drawnWidth: width } : { draw: false, drawnWidth: 0 };
}

/**
 * Whether a resize to `width` needs a redraw of a chart last drawn at `drawnWidth`.
 * @param {number} drawnWidth @param {number} width
 */
export function needsRedraw(drawnWidth, width) {
  return width > 0 && Math.abs(width - drawnWidth) > 8;
}

// ---------------------------------------------------------------------------------------------
// The roster
// ---------------------------------------------------------------------------------------------

/**
 * `rosterView` with the filter checked first: a filter that is no longer offered (no Patient is
 * unassessed or withdrawn any more) falls back to "all" before the view is built, so the roster
 * never shows an empty "No matching Patients" with "All" pressed.
 * @param {Parameters<typeof rosterView>[0]} roster
 * @param {{ search?: string, filter?: string }} options
 * @returns {{ view: ReturnType<typeof rosterView>, filter: string }}
 */
export function rosterFor(roster, { search = "", filter = "all" }) {
  const view = rosterView(roster, { search, filter: /** @type {any} */ (filter) });
  if (view.filters.includes(filter)) return { view, filter };
  return { view: rosterView(roster, { search, filter: "all" }), filter: "all" };
}

/**
 * Everything a roster row shows, as one string: a row whose key is unchanged is kept as it is
 * (and keeps focus); any change rebuilds that row only.
 * @param {{ id: string, sharing: string, name: string, initials?: string, note?: string | null, level: string, levelWord?: string, activeFlags?: unknown[], daily?: unknown[], sleepConsent?: string, checkIn?: string | null, lastPhone?: string | null, freshness?: { stale?: boolean } | null }} p
 */
export function rosterRowKey(p) {
  return JSON.stringify([
    p.id,
    p.sharing,
    p.name,
    p.initials,
    p.note,
    p.level,
    p.levelWord,
    p.activeFlags?.length ?? 0,
    p.sleepConsent ?? null,
    p.daily ?? [],
    p.checkIn,
    p.lastPhone,
    Boolean(p.freshness?.stale),
  ]);
}
