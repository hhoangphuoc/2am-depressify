// The dashboard design's data model, from Firestore documents. Pure: no Firebase imports, no DOM,
// no clock reads, so `node --test` runs it and any UI (this plain-JS dashboard or a React port of
// design/clinician) can import it as an ES module.
//
// The design prototype (design/clinician/src/data.mjs) builds invented Patients in memory. This
// module builds the same shapes from the backend's documents, so the prototype's components can
// show live data unchanged: the patient object, Signals series, attention levels (including the
// display states `unknown` and `hidden`), timeline rows, the Digest with its sources, and what
// seems to help. The mapping, field by field, is in docs/design/dashboard-backend-sync.md.
//
// The rules are not re-implemented here: the level and reasons come from clear.js, sorting from
// sort.js, the banner from banner.js, Baseline from baseline.js, Signals from signals.js, Phases
// and Questionnaire points from timeline.js, Summaries from summaries.js, what helps from
// what-helps.js, the Digest copy from digest.js and Visit checks from visit.js.
//
// Inputs are the documents the Clinician can read (stamped `sharedWithClinician`, through
// `patientCollectionQuery`), each as `{ id, ...data }`. Missing collections may be left out.
import { bannerModel, isOpen } from "./banner.js";
import { MIN_VALID_DAYS, baselineFor, baselineValues } from "./baseline.js";
import { shownAttention } from "./clear.js";
import { addDays, dateInZone, daysBetween, isDateKey, mondayOf } from "./dates.js";
import { digestCoverage, digestGenerated, digestSource } from "./digest.js";
import { asSentence, flagSource } from "./flag-detail.js";
import { reportProblem } from "./intake.js";
import { listMessage, nameMatches } from "./list-filter.js";
import { freshness, latestCheckInText } from "./list-row.js";
import { SHARING_COPY, SHARING_GRANTED } from "./sharing.js";
import { signalState, sourceLabel } from "./signals.js";
import { newestOpenFlagAt, sortPatients } from "./sort.js";
import { sortSummaries, voiceCueText } from "./summaries.js";
import { moodByWeek, phases, pointsByKind, questionnairePoints, weekOf } from "./timeline.js";
import { sortVisits, validateTmsEndDate, validateVisit } from "./visit.js";
import { feelingText, whatHelps, whatHelpsWindow } from "./what-helps.js";

/** The demo's time zone; every function also takes another. */
export const DESIGN_TIME_ZONE = "Europe/Helsinki";

/**
 * The design's level words (`levels` in data.mjs). Checked against ADR 0001 and ADR 0009: three
 * levels with words, no number, and green is "no current flag", never "safe". `unknown` and
 * `hidden` are display states, not levels: nothing stores them, and the stored level stays
 * green, amber or red.
 */
export const DESIGN_LEVELS = Object.freeze({
  red: "Red · Needs attention",
  amber: "Amber · Worth a look",
  green: "Green · No current flag",
  unknown: "Assessment unavailable",
  hidden: "Sharing withdrawn",
});

/** Roster order: red, amber, unassessed, green, withdrawn (`orderPatients` in data.mjs). */
export const DESIGN_LEVEL_ORDER = Object.freeze(["red", "amber", "unknown", "green", "hidden"]);

/**
 * The design's Signal trends (`signalDefinitions` in data.mjs) and the backend Signal behind each.
 * `scale` converts the stored value to the design's unit (minutes to hours). `screen` is the
 * backend's ninth Signal, which the design does not show (`extra: true`).
 */
export const DESIGN_SIGNALS = Object.freeze([
  { key: "sleep", signal: "sleepMinutes", label: "Sleep", unit: "h", max: 12, scale: 1 / 60, origin: "Watch daily aggregate" },
  { key: "steps", signal: "steps", label: "Steps", unit: "steps", max: 10000, scale: 1, origin: "Phone daily aggregate" },
  { key: "heart", signal: "meanHeartRate", label: "Heart rate · daily mean", unit: "bpm", max: 120, scale: 1, origin: "Watch daily aggregate" },
  { key: "rhr", signal: "restingHeartRate", label: "Resting heart rate", unit: "bpm", max: 100, scale: 1, origin: "Watch daily aggregate" },
  // The statistic (RMSSD on Android, SDNN on iOS) is not stored, so the label does not name one.
  { key: "hrv", signal: "hrv", label: "HRV", unit: "ms", max: 90, scale: 1, origin: "Watch daily aggregate" },
  { key: "home", signal: "timeAtHomeMinutes", label: "Time at home", unit: "h", max: 24, scale: 1 / 60, origin: "Phone location aggregate" },
  { key: "radius", signal: "movementRadiusKm", label: "Movement radius", unit: "km", max: 8, scale: 1, origin: "Phone location aggregate" },
  { key: "calendar", signal: "calendarBusyMinutes", label: "Calendar load", unit: "h", max: 8, scale: 1 / 60, origin: "Calendar busy time only" },
  { key: "screen", signal: "lateNightScreenMinutes", label: "Late-night screen time", unit: "min", max: 180, scale: 1, origin: "Phone screen-time aggregate", extra: true },
].map((s) => Object.freeze({ extra: false, ...s })));

/** The most days of daily rows a Patient object carries. */
export const MAX_DAILY_DAYS = 120;

/** The roster reads this many of each Patient's latest daily records: 14 for the sparkline, 14 for its Baseline. */
export const ROSTER_DAILY_DAYS = 28;

/** The Signal the roster's sparkline shows; its Consent is `consents/sleepMinutes`. */
export const ROSTER_SIGNAL = "sleepMinutes";

/** A file the Intake accepts: text, at most this many bytes (the functions take 100,000 characters). */
export const INTAKE_FILE_MAX_BYTES = 100_000;

export const DESIGN_COPY = Object.freeze({
  green: "No current Attention flag.",
  unassessed:
    "The latest Check-in could not be assessed automatically. No automatic judgment is available. Review the Summary; this is not a green result.",
  unassessedSource: "Assessment unavailable",
  withdrawnName: "Patient sharing withdrawn",
  withdrawnNote: SHARING_COPY.withdrawn,
  email: Object.freeze({
    not_applicable: "Not applicable",
    demo: "No email (Demo Patient)",
    requested: "Email requested · delivery is not shown on the dashboard",
  }),
  // Week 1 and Phase 1 start the day after TMS ends (timeline.js), so a Visit on that day would
  // belong to no Phase: a Visit is strictly after the TMS end date.
  visitBeforeTms: "The Visit must be after the TMS end date.",
  visitSameDate: "A Visit is already recorded on that date. Choose another date.",
  tmsAfterVisit: "TMS must end before the first recorded Visit.",
  intakeFile: "Choose a .txt or .md report under 100 KB, or paste the text.",
  noUnknown: "No Patient has an unavailable assessment right now.",
  noHidden: "No Patient has withdrawn sharing in this session.",
});

// ---------------------------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------------------------

/** @param {unknown} value @returns {value is number} */
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

/** @param {number} value */
const round2 = (value) => Math.round(value * 100) / 100;

/** "EN" for "Elias Niemi"; "—" without a name. @param {unknown} name */
export function initialsOf(name) {
  const words = String(name ?? "")
    .replace(/\(.*?\)/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w));
  if (!words.length) return "—";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return `${first}${last}`.toLocaleUpperCase("en");
}

/** "08:10" in the time zone. @param {number} millis @param {string} timeZone */
export function timeOfDay(millis, timeZone = DESIGN_TIME_ZONE) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(millis);
}

/** "13 Nov, 08:10" in the time zone, or null. @param {unknown} millis @param {string} timeZone */
export function shortDateTime(millis, timeZone = DESIGN_TIME_ZONE) {
  if (!isNumber(millis)) return null;
  const day = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short" }).format(millis);
  return `${day}, ${timeOfDay(millis, timeZone)}`;
}

/** @typedef {{ nowMillis: number, timeZone?: string }} Clock */

/** @param {Clock} clock */
function clockOf(clock) {
  const timeZone = clock?.timeZone ?? DESIGN_TIME_ZONE;
  const nowMillis = clock?.nowMillis ?? 0;
  return { nowMillis, timeZone, today: dateInZone(nowMillis, timeZone) };
}

/**
 * @template T
 * @param {T[] | null | undefined} docs
 * @returns {T[]}
 */
const list = (docs) => (Array.isArray(docs) ? docs : []);

// ---------------------------------------------------------------------------------------------
// Attention
// ---------------------------------------------------------------------------------------------

/**
 * The latest Check-in's automatic assessment (`CheckIn.assessment`, added by PR #62): "assessed",
 * "unassessed", "unavailable", or null when unknown (no Check-in, a silent one, or a backend
 * without the field).
 * @param {{ startedAtMillis?: number | null, assessment?: unknown }[] | null | undefined} checkIns
 * @returns {{ assessment: string | null, atMillis: number | null }}
 */
export function latestAssessment(checkIns) {
  const latest = [...list(checkIns)]
    .filter((c) => isNumber(c?.startedAtMillis))
    .sort((a, b) => /** @type {number} */ (b.startedAtMillis) - /** @type {number} */ (a.startedAtMillis))[0];
  if (!latest) return { assessment: null, atMillis: null };
  const value = latest.assessment;
  return {
    assessment: value === "assessed" || value === "unassessed" || value === "unavailable" ? value : null,
    atMillis: /** @type {number} */ (latest.startedAtMillis),
  };
}

/**
 * The level the design shows: `hidden` while not sharing, the highest open flag, `unknown` when
 * nothing is open and the latest assessment is unavailable, else green. A timeout never reads as
 * green, and never hides a flag that is open.
 * @param {{ sharing: "active" | "withdrawn", storedLevel: string, assessment: string | null }} input
 * @returns {"red" | "amber" | "green" | "unknown" | "hidden"}
 */
export function designLevel({ sharing, storedLevel, assessment }) {
  if (sharing !== "active") return "hidden";
  if (storedLevel === "red" || storedLevel === "amber") return storedLevel;
  return assessment === "unavailable" ? "unknown" : "green";
}

/**
 * @typedef {object} DesignFlag
 * @property {string} id
 * @property {"red" | "amber" | "green"} level
 * @property {string | null} kind
 * @property {string} reason
 * @property {string | null} source
 * @property {string | null} observed "13 Nov, 08:10"
 * @property {number | null} raisedAtMillis
 */

/**
 * A flag as the design shows it in the Attention block.
 * @param {{ id: string, level?: string, kind?: string, reason?: string, raisedAtMillis?: number }} flag
 * @param {string} [timeZone]
 * @returns {DesignFlag}
 */
export function designFlag(flag, timeZone = DESIGN_TIME_ZONE) {
  return {
    id: flag.id,
    level: flag.level === "red" ? "red" : flag.level === "amber" ? "amber" : "green",
    kind: flag.kind ?? null,
    reason: asSentence(flag.reason),
    source: flagSource(flag.kind),
    observed: shortDateTime(flag.raisedAtMillis, timeZone),
    raisedAtMillis: isNumber(flag.raisedAtMillis) ? flag.raisedAtMillis : null,
  };
}

/**
 * Whether a flag asks for an email, from the alert policy (`alertDecision` in
 * functions/src/alerts.ts): red only, never for a Demo Patient. Delivery is not readable here
 * (`mail` is closed to clients), so this is what was requested, not what arrived.
 * @param {{ level?: string }} flag
 * @param {{ synthetic?: boolean }} patient
 * @returns {"not_applicable" | "demo" | "requested"}
 */
export function emailStatus(flag, { synthetic }) {
  if (flag.level !== "red") return "not_applicable";
  return synthetic ? "demo" : "requested";
}

/**
 * The flag history, newest first: one "Raised" entry per flag and a "Cleared" entry once cleared.
 * Nothing is dropped; history is never deleted.
 * @param {{ id: string, level?: string, kind?: string, reason?: string, raisedAtMillis?: number, clearedAtMillis?: number | null }[]} flags
 * @param {{ synthetic?: boolean, timeZone?: string }} options
 */
export function designHistory(flags, { synthetic = false, timeZone = DESIGN_TIME_ZONE } = {}) {
  const entries = [];
  for (const flag of list(flags)) {
    const shown = designFlag(flag, timeZone);
    const status = emailStatus(flag, { synthetic });
    entries.push({
      id: `${flag.id}-raised`,
      flagId: flag.id,
      level: shown.level,
      action: "Raised",
      atMillis: shown.raisedAtMillis,
      date: shown.observed,
      reason: shown.reason,
      source: shown.source,
      emailStatus: status,
      email: DESIGN_COPY.email[status],
    });
    if (!isOpen(flag)) {
      entries.push({
        id: `${flag.id}-cleared`,
        flagId: flag.id,
        level: shown.level,
        action: "Cleared",
        atMillis: isNumber(flag.clearedAtMillis) ? flag.clearedAtMillis : null,
        date: shortDateTime(flag.clearedAtMillis, timeZone),
        reason: shown.reason,
        source: "Clinician action",
        emailStatus: "not_applicable",
        email: DESIGN_COPY.email.not_applicable,
      });
    }
  }
  return entries.sort((a, b) => (b.atMillis ?? 0) - (a.atMillis ?? 0));
}

/**
 * The Attention block: the design level, the open flags (highest first, then newest) and the top
 * reason, source and time. Until the flags load, the record's level and reasons stand in.
 * @param {Partial<import("./contract.js").PatientDoc>} patient
 * @param {any[] | null | undefined} flags the visible flags (`{ id, ...data }`), or null while loading
 * @param {{ checkIns?: object[] | null, timeZone?: string }} [options]
 */
export function designAttention(patient, flags, { checkIns = null, timeZone = DESIGN_TIME_ZONE } = {}) {
  const sharing = patient?.sharingConsent === SHARING_GRANTED ? "active" : "withdrawn";
  const shown = shownAttention(patient ?? {}, flags);
  const { assessment, atMillis } = latestAssessment(checkIns);
  /** @type {DesignFlag[]} */
  let activeFlags;
  if (Array.isArray(flags)) {
    const rank = (/** @type {string} */ l) => (l === "red" ? 0 : l === "amber" ? 1 : 2);
    activeFlags = /** @type {any[]} */ (flags)
      .filter(isOpen)
      .map((f) => designFlag(/** @type {any} */ (f), timeZone))
      .sort((a, b) => rank(a.level) - rank(b.level) || (b.raisedAtMillis ?? 0) - (a.raisedAtMillis ?? 0));
  } else {
    // Flags not loaded yet: the record's reasons, without ids, times or sources.
    activeFlags = shown.flagReasons.map((reason, i) => ({
      id: `record-${i}`,
      level: shown.flagLevel,
      kind: null,
      reason: asSentence(reason),
      source: null,
      observed: null,
      raisedAtMillis: null,
    }));
  }
  const level = designLevel({ sharing, storedLevel: shown.flagLevel, assessment });
  const top = activeFlags[0] ?? null;
  const unknown = level === "unknown";
  return {
    level,
    storedLevel: shown.flagLevel,
    levelWord: DESIGN_LEVELS[level],
    activeFlags,
    reason: top ? top.reason : unknown ? DESIGN_COPY.unassessed : level === "green" ? DESIGN_COPY.green : null,
    source: top ? top.source : unknown ? DESIGN_COPY.unassessedSource : null,
    observed: top ? top.observed : unknown ? shortDateTime(atMillis, timeZone) : null,
    assessment,
    assessmentStatus: assessment === "unavailable" ? "unavailable" : "complete",
    flagsLoaded: Array.isArray(flags),
  };
}

// ---------------------------------------------------------------------------------------------
// Daily rows and Signals
// ---------------------------------------------------------------------------------------------

/**
 * The dates the daily rows cover: from the TMS end date (or the first record, if earlier) to today,
 * at most `maxDays`.
 * @param {{ daily?: { date?: string }[], tmsEndDate?: string | null, today: string, maxDays?: number }} input
 * @returns {{ start: string, end: string }}
 */
export function dailyRange({ daily, tmsEndDate, today, maxDays = MAX_DAILY_DAYS }) {
  const candidates = [
    ...list(daily).map((d) => d?.date),
    tmsEndDate,
  ].filter((d) => isDateKey(d) && /** @type {string} */ (d) <= today);
  const first = /** @type {string[]} */ (candidates).sort()[0] ?? today;
  const earliest = addDays(today, -(maxDays - 1));
  return { start: first < earliest ? earliest : first, end: today };
}

/**
 * Consent for each Signal: `granted !== true` hides its values (`signalState` "no_consent").
 * Consents not loaded (null) hide everything: an unknown Consent is never treated as granted.
 * @param {{ id?: string, subject?: string, granted?: unknown }[] | null | undefined} consents
 */
function consentLookup(consents) {
  if (!Array.isArray(consents)) return () => null;
  /** @type {Map<string, { granted?: unknown }>} */
  const bySubject = new Map();
  for (const c of consents) bySubject.set(String(c?.subject ?? c?.id ?? ""), c);
  return (/** @type {string} */ key) => bySubject.get(key) ?? null;
}

/**
 * The design's daily rows: one per calendar date in `range`, oldest first, each with every design
 * Signal in the design's unit and the day's Mood rating (from that day's latest Summary, so the
 * charts and Summaries agree). A missing record, a null value or a Signal without Consent is null,
 * never zero; with `consents` null (not loaded) every Signal is null.
 * @param {{ date: string, values?: Record<string, unknown> }[]} daily
 * @param {{ range: { start: string, end: string }, summaries?: { date: string | null, mood: number | null }[], consents?: object[] | null }} options
 *   `summaries` in the design's shape (`designSummaries`)
 */
export function designDaily(daily, { range, summaries = [], consents = null }) {
  const consentOf = consentLookup(/** @type {any} */ (consents));
  /** @type {Map<string, { values?: Record<string, unknown> }>} */
  const byDate = new Map();
  for (const doc of list(daily)) if (isDateKey(doc?.date)) byDate.set(doc.date, doc);
  /** @type {Map<string, number | null>} */
  const moodByDate = new Map();
  // Newest first: the first Summary of a date is that day's latest.
  for (const s of summaries) if (s.date !== null && !moodByDate.has(s.date)) moodByDate.set(s.date, Number.isInteger(s.mood) ? s.mood : null);

  const rows = [];
  for (let date = range.start; date <= range.end; date = addDays(date, 1)) {
    const doc = byDate.get(date);
    /** @type {Record<string, number | null | string>} */
    const row = { date, mood: moodByDate.get(date) ?? null };
    for (const s of DESIGN_SIGNALS) {
      const value = doc?.values?.[s.signal];
      row[s.key] = isNumber(value) && consentOf(s.signal)?.granted === true ? round2(value * s.scale) : null;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Each design Signal: its state (`signalState`: no_consent, no_data, stale, ok), the latest value
 * and the Patient's own Baseline for today (median of the previous 14 days, at least 5 valid days,
 * from baseline.js), in the design's unit.
 * @param {{ date: string, values?: Record<string, unknown> }[]} daily
 * @param {{ today: string, consents?: object[] | null, healthSource?: string }} options
 */
export function designSignals(daily, { today, consents = null, healthSource }) {
  const consentOf = consentLookup(/** @type {any} */ (consents));
  return DESIGN_SIGNALS.map((s) => {
    const consent = consentOf(s.signal);
    const state = signalState({ consent, docs: list(daily), key: s.signal, today });
    const hidden = state === "no_consent";
    const history = hidden ? [] : list(daily).map((d) => ({ date: d.date, value: /** @type {any} */ (d.values?.[s.signal]) }));
    const base = baselineFor(history, today);
    const validDays = baselineValues(history, today).length;
    const latest = hidden
      ? null
      : history
          .filter((h) => isDateKey(h.date) && h.date <= today && isNumber(h.value))
          .sort((a, b) => (a.date < b.date ? 1 : -1))
          .map((h) => ({ date: h.date, value: round2(/** @type {number} */ (h.value) * s.scale) }))[0] ?? null;
    return {
      key: s.key,
      signal: s.signal,
      label: s.label,
      unit: s.unit,
      max: s.max,
      origin: s.origin,
      extra: s.extra,
      healthSource: healthSource ?? null,
      sourceLabel: sourceLabel(healthSource),
      state,
      latest,
      baseline: {
        value: base ? round2(base.centre * s.scale) : null,
        validDays,
        minDays: MIN_VALID_DAYS,
        status: base ? "ready" : "building",
      },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Summaries, Visits, Intake, Digest, what helps, timeline
// ---------------------------------------------------------------------------------------------

/**
 * The Suggestion whose Outcome a Summary reports: the one whose `outcomeCheckInId` is this
 * Check-in (PR #65), else the newest Suggestion made before the Check-in started.
 * @param {any[]} suggestions
 * @param {string} checkInId
 * @param {number | null} startedAtMillis
 * @returns {any}
 */
function previousSuggestionOf(suggestions, checkInId, startedAtMillis) {
  const linked = suggestions.find((s) => s?.outcomeCheckInId === checkInId);
  if (linked) return linked;
  if (!isNumber(startedAtMillis)) return null;
  return (
    suggestions
      .filter((s) => isNumber(s?.suggestedAtMillis) && /** @type {number} */ (s.suggestedAtMillis) < startedAtMillis)
      .sort((a, b) => /** @type {number} */ (b.suggestedAtMillis) - /** @type {number} */ (a.suggestedAtMillis))[0] ?? null
  );
}

/** @param {unknown} value */
const sentence = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

/**
 * The design's Summaries, newest first. The stored Summary is structured (ADR 0005: the Patient
 * reads the same); `text` only joins its stored sentences (the sleep line, the previous Outcome
 * and the Suggestion) and adds no words of its own. The structured fields come too.
 * @param {object[]} summaries
 * @param {{ checkIns?: object[], suggestions?: object[], timeZone?: string }} [options]
 */
export function designSummaries(summaries, { checkIns = [], suggestions = [], timeZone = DESIGN_TIME_ZONE } = {}) {
  /** @type {Map<string, any>} */
  const checkInById = new Map(list(/** @type {any} */ (checkIns)).map((c) => [String(c.id), c]));
  const ranked = sortSummaries(list(/** @type {any} */ (summaries)));
  return ranked.map((/** @type {any} */ s) => {
    const id = String(s.id ?? s.checkInId ?? "");
    const checkIn = checkInById.get(id);
    const startedAtMillis = isNumber(checkIn?.startedAtMillis) ? checkIn.startedAtMillis : null;
    const at = startedAtMillis ?? (isNumber(s.createdAtMillis) ? s.createdAtMillis : null);
    const previous = previousSuggestionOf(list(/** @type {any} */ (suggestions)), id, startedAtMillis);
    const suggestion = sentence(s.suggestion);
    const voiceCues = Array.isArray(s.voiceCues) ? s.voiceCues.map(voiceCueText) : [];
    return {
      id,
      date: at === null ? null : dateInZone(at, timeZone),
      time: at === null ? null : timeOfDay(at, timeZone),
      generated: isNumber(s.createdAtMillis) ? timeOfDay(s.createdAtMillis, timeZone) : null,
      createdAtMillis: isNumber(s.createdAtMillis) ? s.createdAtMillis : null,
      text: [sentence(s.sleepLine), sentence(s.previousOutcome), suggestion].filter(Boolean).join(" "),
      mood: Number.isInteger(s.mood) ? s.mood : null,
      energy: Number.isInteger(s.energy) ? s.energy : null,
      sleep: Number.isInteger(s.sleepQuality) ? s.sleepQuality : null,
      sleepLine: sentence(s.sleepLine),
      themes: Array.isArray(s.themes) ? s.themes.filter((/** @type {unknown} */ t) => typeof t === "string" && t.trim()) : [],
      voice: voiceCues.length ? voiceCues.join("; ") : null,
      voiceCues,
      suggestion,
      previousOutcome: sentence(s.previousOutcome),
      previousKind: previous?.kind ?? null,
      tried: typeof previous?.tried === "boolean" ? previous.tried : null,
      feeling: Number.isInteger(previous?.felt) ? previous.felt : null,
      quotes: Array.isArray(s.quotes) ? s.quotes.filter((/** @type {unknown} */ q) => typeof q === "string" && q.trim()).slice(0, 3) : [],
    };
  });
}

const QUESTIONNAIRE_TYPES = Object.freeze({ phq2: "PHQ-2", phq9: "PHQ-9" });

/**
 * The design's Visits, newest first: `type` is "PHQ-2", "PHQ-9" or "none".
 * @param {{ id: string, date: string, questionnaire?: string | null, score?: number | null }[]} visits
 */
export function designVisits(visits) {
  return sortVisits(list(/** @type {any} */ (visits))).map((/** @type {any} */ v) => {
    /** @type {string} */
    const type = QUESTIONNAIRE_TYPES[/** @type {"phq2" | "phq9"} */ (v.questionnaire)] ?? "none";
    return { id: v.id, date: v.date, type, score: type === "none" || !Number.isInteger(v.score) ? null : v.score };
  });
}

/**
 * The saved highlights as a list: one per line, or one per sentence when they are one paragraph.
 * @param {unknown} text
 * @returns {string[]}
 */
export function highlightsList(text) {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) return [];
  const lines = value.split(/\n+/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim()).filter(Boolean);
  const parts = lines.length > 1 ? lines : value.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return parts;
}

/** The list back as the text `saveIntake` takes, one highlight per line. @param {string[]} items */
export function highlightsText(items) {
  return list(/** @type {any} */ (items)).map((h) => `- ${String(h).trim()}`).filter((h) => h !== "- ").join("\n");
}

/**
 * The design's Intake: the saved highlights, or null when there are none. The saved date is not
 * stored by the backend, so `date` is null (see the sync note).
 * @param {Partial<import("./contract.js").PatientDoc>} patient
 */
export function designIntake(patient) {
  const highlights = highlightsList(patient?.intakeHighlights);
  return highlights.length ? { date: null, highlights, text: String(patient?.intakeHighlights ?? "") } : null;
}

/**
 * The design's Digest `{ time, ids, text }` and more: dates covered, generated time, the source
 * count and the source Summaries (`sourceCheckInIds`). A Digest written before the field existed
 * has `ids: null`; show the count.
 * @param {import("./contract.js").Digest | null | undefined} digest
 * @param {{ summaries?: ReturnType<typeof designSummaries>, today: string, timeZone?: string }} options
 */
export function designDigest(digest, { summaries = [], today, timeZone = DESIGN_TIME_ZONE }) {
  if (!digest || typeof digest.text !== "string") return null;
  const ids = Array.isArray(digest.sourceCheckInIds) ? digest.sourceCheckInIds.map(String) : null;
  const byId = new Map(summaries.map((s) => [s.id, s]));
  const sources = (ids ?? []).map((id) => byId.get(id)).filter((s) => s !== undefined);
  return {
    isoWeek: digest.isoWeek,
    weekStart: digest.weekStart,
    weekEnd: digest.weekEnd,
    text: digest.text,
    time: shortDateTime(digest.generatedAtMillis, timeZone),
    generatedAtMillis: digest.generatedAtMillis,
    generated: digestGenerated(digest.generatedAtMillis, timeZone),
    coverage: digestCoverage(digest),
    summaryCount: digest.summaryCount,
    source: digestSource(digest),
    ids,
    sources,
    /** Source ids not among the loaded Summaries (none, once the Summaries have loaded). */
    missingSources: ids ? ids.length - sources.length : 0,
    /** A Digest of an earlier week than this one. */
    stale: isDateKey(digest.weekEnd) && digest.weekEnd < mondayOf(today),
  };
}

/**
 * What seems to help, per kind of Suggestion, over the stated window: the existing rows
 * (`whatHelps`: scored Suggestions only, counts and feeling groups) plus the design's mean of the
 * Patient's own 1 to 5 answers (`feltMean`, null without any). The Outcome score is never shown.
 * @param {object[]} suggestions
 * @param {{ today: string, timeZone?: string }} options
 */
export function designWhatHelps(suggestions, { today, timeZone = DESIGN_TIME_ZONE }) {
  const window = whatHelpsWindow(today);
  const { rows, waiting } = whatHelps(/** @type {any} */ (list(/** @type {any} */ (suggestions))), { ...window, timeZone });
  const scored = list(/** @type {any} */ (suggestions)).filter((/** @type {any} */ s) => {
    if (!isNumber(s?.outcomeScore) || !isNumber(s?.suggestedAtMillis)) return false;
    const date = dateInZone(s.suggestedAtMillis, timeZone);
    return date >= window.start && date <= window.end;
  });
  return {
    window,
    waiting,
    rows: rows.map(({ kind, label, n, feelings }) => {
      const felt = scored.filter((/** @type {any} */ s) => s.kind === kind && s.tried === true && Number.isInteger(s.felt)).map((/** @type {any} */ s) => s.felt);
      return {
        kind,
        label,
        outcomes: n,
        feelings,
        feelingText: feelingText(feelings),
        tried: n - feelings.notTried,
        feltCount: felt.length,
        feltMean: felt.length ? round2(felt.reduce((a, b) => a + b, 0) / felt.length) : null,
      };
    }),
  };
}

/**
 * The Overview timeline: weeks since TMS, Phases (`phases` in timeline.js, in the design's
 * `{ start, end, label }` shape), weekly Mood and the Questionnaire lanes by type.
 * @param {{ tmsEndDate?: string | null, visits?: object[], checkIns?: object[], today: string, timeZone?: string }} input
 */
export function designTimeline({ tmsEndDate = null, visits = [], checkIns = [], today, timeZone = DESIGN_TIME_ZONE }) {
  const tms = isDateKey(tmsEndDate) ? tmsEndDate : null;
  const phaseList = tms ? phases(tms, /** @type {any} */ (visits), today) : [];
  const byKind = pointsByKind(questionnairePoints(/** @type {any} */ (visits), tms));
  /** @type {Record<string, { id: string | undefined, date: string, score: number, week: number | null }[]>} */
  const questionnaires = {};
  for (const [kind, points] of Object.entries(byKind)) {
    questionnaires[QUESTIONNAIRE_TYPES[/** @type {"phq2" | "phq9"} */ (kind)]] = (points ?? []).map((p) => ({ id: p.id, date: p.date, score: p.score, week: p.week }));
  }
  return {
    tms,
    weekSinceTms: tms ? weekOf(today, tms) : null,
    daysSinceTms: tms ? daysBetween(tms, today) : null,
    phases: phaseList.map((p) => ({ number: p.number, start: p.start, end: p.end, label: `Phase ${p.number}`, startWeek: p.startWeek, endWeek: p.endWeek })),
    moodWeeks: moodByWeek(/** @type {any} */ (checkIns), tms, { today, timeZone }),
    questionnaires,
  };
}

// ---------------------------------------------------------------------------------------------
// The patient object
// ---------------------------------------------------------------------------------------------

/**
 * A Patient who is not sharing: no name, no data (`withdrawSharing` in data.mjs). The backend hides
 * the records; it does not delete them (future-only sharing), so the note says "not sharing".
 * @param {string} id
 */
export function withdrawnPatient(id) {
  return {
    id,
    name: DESIGN_COPY.withdrawnName,
    initials: "—",
    sharing: "withdrawn",
    level: "hidden",
    levelWord: DESIGN_LEVELS.hidden,
    storedLevel: "green",
    note: DESIGN_COPY.withdrawnNote,
    reason: null,
    source: null,
    observed: null,
    quote: null,
    lastPhone: null,
    checkIn: null,
    freshness: null,
    activeFlags: [],
    flagsLoaded: false,
    flagsError: false,
    history: [],
    summaries: [],
    daily: [],
    signals: [],
    visits: [],
    intake: null,
    digest: null,
    tms: null,
    timeline: null,
    whatHelps: null,
    alertsEnabled: false,
    assessmentStatus: "complete",
    assessment: null,
    synthetic: null,
    healthSource: null,
  };
}

/**
 * @typedef {object} PatientSources the documents the Clinician can read, each `{ id, ...data }`
 * @property {string} id
 * @property {Partial<import("./contract.js").PatientDoc>} patient the record's data
 * @property {object[] | null} [flags] null or missing: not loaded yet
 * @property {object[]} [daily]
 * @property {object[]} [checkIns]
 * @property {object[]} [summaries]
 * @property {object[]} [suggestions]
 * @property {object[]} [visits]
 * @property {object[]} [digests] the latest first; only the first is used
 * @property {object[] | null} [consents] null or missing: not loaded, which hides every Signal
 * @property {boolean} [flagsError] the flags could not be loaded (not a withdrawal): the record's
 *   level and reasons stand in, and `flagsError` tells the UI to say so
 */

/**
 * One Patient in the design's shape (`createPatients()` in data.mjs), plus the extra fields the
 * design needs from the backend: `signals`, `timeline`, `whatHelps`, `freshness`, `storedLevel`.
 * @param {PatientSources} sources
 * @param {Clock} clock
 * @param {{ maxDays?: number }} [options]
 */
export function designPatient(sources, clock, { maxDays = MAX_DAILY_DAYS } = {}) {
  const { id } = sources;
  const record = sources.patient ?? {};
  if (record.sharingConsent !== SHARING_GRANTED) return withdrawnPatient(id);
  const { nowMillis, timeZone, today } = clockOf(clock);

  const attention = designAttention(record, sources.flags ?? null, { checkIns: sources.checkIns ?? null, timeZone });
  const summaries = designSummaries(sources.summaries ?? [], { checkIns: sources.checkIns ?? [], suggestions: sources.suggestions ?? [], timeZone });
  const range = dailyRange({ daily: /** @type {any} */ (sources.daily), tmsEndDate: record.tmsEndDate, today, maxDays });
  const daily = designDaily(/** @type {any} */ (sources.daily ?? []), { range, summaries, consents: sources.consents ?? null });
  const name = record.displayName || "Unnamed patient";
  const fresh = freshness(record.lastSeenAtMillis, nowMillis);
  const latestDigest = list(/** @type {any} */ (sources.digests))[0] ?? null;

  return {
    id,
    name,
    initials: initialsOf(name),
    sharing: "active",
    level: attention.level,
    levelWord: attention.levelWord,
    storedLevel: attention.storedLevel,
    reason: attention.reason,
    source: attention.source,
    observed: attention.observed,
    // The design's roster subtitle is free text; the backend's nearest is the first open reason.
    note: attention.activeFlags[0]?.reason ?? null,
    // Not linked on `main`: needs PR #62's `<kind>-<checkInId>` flag ids.
    quote: null,
    lastPhone: typeof record.lastSeenAtMillis === "number" ? latestCheckInText(record.lastSeenAtMillis, nowMillis, timeZone) : "Never seen",
    checkIn: latestCheckInText(record.lastCheckInAtMillis, nowMillis, timeZone),
    freshness: fresh,
    alertsEnabled: record.synthetic !== true,
    assessmentStatus: attention.assessmentStatus,
    assessment: attention.assessment,
    activeFlags: attention.activeFlags,
    flagsLoaded: attention.flagsLoaded,
    flagsError: sources.flagsError === true,
    history: Array.isArray(sources.flags) ? designHistory(/** @type {any} */ (sources.flags), { synthetic: record.synthetic === true, timeZone }) : [],
    daily,
    range,
    signals: designSignals(/** @type {any} */ (sources.daily ?? []), { today, consents: sources.consents ?? null, healthSource: record.healthSource }),
    summaries,
    tms: isDateKey(record.tmsEndDate) ? record.tmsEndDate : null,
    visits: designVisits(/** @type {any} */ (sources.visits ?? [])),
    intake: designIntake(record),
    digest: designDigest(latestDigest, { summaries, today, timeZone }),
    timeline: designTimeline({ tmsEndDate: record.tmsEndDate, visits: sources.visits ?? [], checkIns: sources.checkIns ?? [], today, timeZone }),
    whatHelps: designWhatHelps(sources.suggestions ?? [], { today, timeZone }),
    synthetic: record.synthetic === true,
    healthSource: record.healthSource ?? null,
    today,
  };
}

/**
 * @typedef {object} RosterSources what the roster reads for one Patient, each `{ id, ...data }`
 * @property {string} id
 * @property {Partial<import("./contract.js").PatientDoc>} patient the record's data
 * @property {object[] | null} [flags] null or missing: not loaded (the record's level stands in)
 * @property {object[]} [daily] the latest daily records
 * @property {object[]} [checkIns] the latest Check-in
 * @property {{ granted?: unknown } | null} [sleepConsent] the `consents/sleepMinutes` document's
 *   data; null when there is none; undefined while it loads. Only `granted: true` shows sleep.
 */

/**
 * One roster row: the light part of `designPatient` the roster shows (level, open flags and
 * reasons, the 14-day sleep sparkline, the latest Check-in, phone freshness), without Summaries,
 * Signals, the timeline or what helps. The daily rows carry only `date` and `sleep`, and `sleep` is
 * null unless the Patient's sleep Consent is known to be granted: a withheld or unknown Consent puts
 * no value in the row. `rosterView` and `orderRoster` take it like a `designPatient` object.
 * @param {RosterSources} sources
 * @param {Clock} clock
 * @param {{ maxDays?: number }} [options]
 */
export function designRosterPatient(sources, clock, { maxDays = ROSTER_DAILY_DAYS } = {}) {
  const { id } = sources;
  const record = sources.patient ?? {};
  if (record.sharingConsent !== SHARING_GRANTED) return withdrawnPatient(id);
  const { nowMillis, timeZone, today } = clockOf(clock);
  const attention = designAttention(record, sources.flags ?? null, { checkIns: sources.checkIns ?? null, timeZone });
  const consent = sources.sleepConsent;
  const sleepConsent = consent === undefined ? "unknown" : consent?.granted === true ? "granted" : "withheld";
  const range = dailyRange({ daily: /** @type {any} */ (sources.daily), tmsEndDate: record.tmsEndDate, today, maxDays });
  const consents = sleepConsent === "granted" ? [{ subject: ROSTER_SIGNAL, granted: true }] : [];
  const sleepKey = /** @type {string} */ (DESIGN_SIGNALS.find((s) => s.signal === ROSTER_SIGNAL)?.key);
  const daily = designDaily(/** @type {any} */ (sources.daily ?? []), { range, consents }).map((row) => ({ date: row.date, [sleepKey]: row[sleepKey] }));
  const name = record.displayName || "Unnamed patient";
  return {
    id,
    name,
    initials: initialsOf(name),
    sharing: "active",
    level: attention.level,
    levelWord: attention.levelWord,
    storedLevel: attention.storedLevel,
    reason: attention.reason,
    source: attention.source,
    observed: attention.observed,
    note: attention.activeFlags[0]?.reason ?? null,
    lastPhone: typeof record.lastSeenAtMillis === "number" ? latestCheckInText(record.lastSeenAtMillis, nowMillis, timeZone) : "Never seen",
    checkIn: latestCheckInText(record.lastCheckInAtMillis, nowMillis, timeZone),
    freshness: freshness(record.lastSeenAtMillis, nowMillis),
    alertsEnabled: record.synthetic !== true,
    assessmentStatus: attention.assessmentStatus,
    assessment: attention.assessment,
    activeFlags: attention.activeFlags,
    flagsLoaded: attention.flagsLoaded,
    daily,
    sleepConsent,
    range,
    synthetic: record.synthetic === true,
    today,
  };
}

// ---------------------------------------------------------------------------------------------
// The roster
// ---------------------------------------------------------------------------------------------

/**
 * The roster in the design's order: red, amber, unassessed, green, withdrawn; within a level the
 * newest open flag first, then the name (`sortPatients` in sort.js). Returns a new array.
 * @template {{ id: string, name: string, level: string, storedLevel?: string, activeFlags?: { raisedAtMillis: number | null }[] }} T
 * @param {T[]} patients
 * @returns {T[]}
 */
export function orderRoster(patients) {
  /** @type {Record<string, number | null>} */
  const latest = {};
  for (const p of patients) {
    latest[p.id] = newestOpenFlagAt(
      (p.activeFlags ?? []).filter((f) => isNumber(f.raisedAtMillis)).map((f) => ({ raisedAtMillis: /** @type {number} */ (f.raisedAtMillis), clearedAtMillis: null })),
    );
  }
  const sorted = sortPatients(
    patients.map((p) => ({ id: p.id, displayName: p.name, flagLevel: p.storedLevel ?? "green", patient: p })),
    latest,
  );
  const position = new Map(sorted.map((s, i) => [s.patient, i]));
  const rank = (/** @type {string} */ level) => {
    const i = DESIGN_LEVEL_ORDER.indexOf(level);
    return i < 0 ? DESIGN_LEVEL_ORDER.length : i;
  };
  return [...patients].sort((a, b) => rank(a.level) - rank(b.level) || /** @type {number} */ (position.get(a)) - /** @type {number} */ (position.get(b)));
}

/**
 * What the roster shows for a search and a level filter: the filtered Patients, the counts per
 * level (before filtering), the red banner (from every Patient, so filters never hide it) and the
 * line under the controls.
 * @param {{ patients: ReturnType<typeof designPatient>[] }} roster
 * @param {{ search?: string, filter?: "all" | "red" | "amber" | "unknown" | "green" | "hidden" }} [options]
 */
export function rosterView(roster, { search = "", filter = "all" } = {}) {
  const all = orderRoster(list(/** @type {any} */ (roster?.patients)));
  const counts = { all: all.length, red: 0, amber: 0, unknown: 0, green: 0, hidden: 0 };
  for (const p of all) counts[/** @type {keyof typeof counts} */ (p.level)] += 1;
  const patients = all.filter((p) => (filter === "all" || p.level === filter) && (p.sharing !== "active" ? search.trim() === "" : nameMatches(p.name, search)));

  /** @type {Record<string, string>} */
  const namesById = {};
  const flags = [];
  for (const p of all) {
    if (p.sharing !== "active") continue;
    namesById[p.id] = p.name;
    for (const f of p.activeFlags ?? []) {
      if (!f.id.startsWith("record-")) flags.push({ ...f, patientId: p.id, clearedAtMillis: null, raisedAtMillis: f.raisedAtMillis ?? 0 });
    }
  }
  const level = filter === "red" || filter === "amber" || filter === "green" ? filter : "all";
  let message = listMessage({ total: all.length, shown: patients.length, search, level });
  if ((filter === "unknown" || filter === "hidden") && patients.length === 0 && all.length > 0) {
    message = { kind: "noMatch", text: filter === "unknown" ? DESIGN_COPY.noUnknown : DESIGN_COPY.noHidden };
  } else if ((filter === "unknown" || filter === "hidden") && all.length > 0) {
    message = { kind: "filtered", text: `Showing ${patients.length} of ${all.length} Patients.` };
  }
  return {
    patients,
    all,
    counts,
    reds: all.filter((p) => p.level === "red"),
    banner: bannerModel(/** @type {any} */ (flags), namesById),
    message,
    // The design shows an "Unassessed" filter only when someone is unassessed.
    filters: ["all", "red", "amber", ...(counts.unknown ? ["unknown"] : []), "green", ...(counts.hidden ? ["hidden"] : [])],
  };
}

// ---------------------------------------------------------------------------------------------
// Form checks the design adds to the backend's
// ---------------------------------------------------------------------------------------------

const DESIGN_TYPES = Object.freeze({ none: "", "PHQ-2": "phq2", "PHQ-9": "phq9" });

/**
 * The design's Record a Visit form `{ date, type: "none" | "PHQ-2" | "PHQ-9", score }`, checked with
 * `validateVisit` (visit.js: not in the future, integer in range) and the design's two extra rules:
 * strictly after the TMS end date (Phase 1 starts the day after, so a Visit on that day would be in
 * no Phase and off the timeline), and one Visit per date.
 * @param {{ date: string, type: string, score?: string | number | null }} form
 * @param {{ today: string, tms?: string | null, visits?: { id?: string, date: string }[], editingId?: string | null }} context
 * @returns {{ ok: true, visit: import("./visit.js").Visit } | { ok: false, message: string, errors?: { date?: string, questionnaire?: string, score?: string } }}
 */
export function validateDesignVisit(form, { today, tms = null, visits = [], editingId = null }) {
  const kind = DESIGN_TYPES[/** @type {keyof typeof DESIGN_TYPES} */ (form?.type)];
  const result = validateVisit({ date: form?.date ?? "", questionnaire: kind ?? String(form?.type ?? ""), score: kind === "" ? "" : form?.score ?? "" }, today);
  if (!result.ok) {
    const { date, questionnaire, score } = result.errors;
    return { ok: false, message: /** @type {string} */ (date ?? questionnaire ?? score), errors: result.errors };
  }
  if (isDateKey(tms) && result.visit.date <= tms) return { ok: false, message: DESIGN_COPY.visitBeforeTms, errors: { date: DESIGN_COPY.visitBeforeTms } };
  if (visits.some((v) => v.date === result.visit.date && v.id !== editingId)) return { ok: false, message: DESIGN_COPY.visitSameDate, errors: { date: DESIGN_COPY.visitSameDate } };
  return result;
}

/**
 * The TMS end date: `validateTmsEndDate` plus the design's rule that it is strictly before every
 * recorded Visit (the same rule as `validateDesignVisit`, from the other side).
 * @param {string} date
 * @param {{ today: string, visits?: { date: string }[] }} context
 * @returns {{ ok: true, date: string } | { ok: false, message: string }}
 */
export function validateDesignTms(date, { today, visits = [] }) {
  const result = validateTmsEndDate(date, today);
  if (!result.ok) return { ok: false, message: result.error };
  if (visits.some((v) => isDateKey(v.date) && v.date <= result.date)) return { ok: false, message: DESIGN_COPY.tmsAfterVisit };
  return result;
}

/**
 * Why a chosen Intake file cannot be used, or null: `.txt` or `.md`, at most 100 KB. The browser
 * reads it as text, and the text is checked again by `reportProblem` (intake.js) before extraction.
 * @param {{ name?: string, size?: number } | null | undefined} file
 */
export function intakeFileProblem(file) {
  const name = String(file?.name ?? "").toLowerCase();
  if (!(name.endsWith(".txt") || name.endsWith(".md"))) return DESIGN_COPY.intakeFile;
  if (!isNumber(file?.size) || /** @type {number} */ (file?.size) > INTAKE_FILE_MAX_BYTES) return DESIGN_COPY.intakeFile;
  return null;
}

/** Re-exported so the UI checks pasted text with the same rule. */
export { reportProblem };
