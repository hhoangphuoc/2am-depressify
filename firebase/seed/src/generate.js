// Pure generator for the Demo Patients. Same inputs, same output: the only sources of variation
// are the seed and the dates passed in. Nothing here reads the clock or touches Firestore.
import { CONSENT_PURPOSES } from "../../hosting/js/lib/contract.js";
import { SIGNAL_KEYS, baselineFor, dailyComparisons, oriented } from "./baseline.js";
import { DEMO_TIME_ZONE, addDays, dateInZone, isWeekend, zonedMillis } from "./dates.js";
import { draftsFor } from "./flags.js";
import { PROFILES } from "./profiles.js";
import { createRandom, hashString } from "./random.js";

/** @typedef {import("../../functions/src/types.ts").PatientDoc} PatientDoc */
/** @typedef {import("../../functions/src/types.ts").DailyDoc} DailyDoc */
/** @typedef {import("../../functions/src/types.ts").Consent} Consent */
/** @typedef {import("../../functions/src/types.ts").CheckIn} CheckIn */
/** @typedef {import("../../functions/src/types.ts").Summary} Summary */
/** @typedef {import("../../functions/src/types.ts").Suggestion} Suggestion */
/** @typedef {import("../../functions/src/types.ts").SuggestionKind} SuggestionKind */
/** @typedef {import("../../functions/src/types.ts").Flag} Flag */
/** @typedef {import("../../functions/src/types.ts").Visit} Visit */
/** @typedef {import("../../functions/src/types.ts").VoiceCue} VoiceCue */
/** @typedef {import("../../functions/src/types.ts").SignalKey} SignalKey */
/** @typedef {import("./baseline.js").SignalMap} SignalMap */
/** @typedef {import("./profiles.js").Profile} Profile */
/** @typedef {import("./random.js").Random} Random */

/**
 * @template T
 * @typedef {{ id: string, data: T }} Entry
 */

/**
 * One Demo Patient as documents: the Patient record and each collection under it.
 * @typedef {object} DemoPatient
 * @property {string} id
 * @property {string} profile
 * @property {PatientDoc} patient
 * @property {Entry<DailyDoc>[]} daily
 * @property {Entry<Consent>[]} consents
 * @property {Entry<CheckIn>[]} checkIns
 * @property {Entry<Summary>[]} summaries
 * @property {Entry<Suggestion>[]} suggestions
 * @property {Entry<Flag>[]} flags
 * @property {Entry<Visit>[]} visits
 */

/**
 * @typedef {object} SeedOptions
 * @property {string} today yyyy-MM-dd in the demo time zone; the last daily record's date
 * @property {number} [nowMillis] the moment of seeding; nothing is stamped later than this.
 *   Defaults to noon on `today`, so the output depends only on the inputs.
 * @property {number} [seed] base seed for the pseudo-random source
 * @property {string} [clinicianEmail]
 */

export const DEMO_CLINICIAN_EMAIL = "clinician@example.com";
export const DEFAULT_SEED = 20_260_514;
export const DAILY_RECORDS = 42;
export const TMS_END_DAYS_AGO = 42;
export const VISIT_DAYS_AGO = 21;
export const PROFILE_ORDER = /** @type {const} */ (["steady", "declining", "sparse"]);
const NOT_TRIED_OUTCOME = -0.1;

/** @param {number} value @param {number} min @param {number} max */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
/** @param {number} value */
const round1 = (value) => Math.round(value * 10) / 10;

/**
 * The Signal values for one day of a profile. Missing values are null, never zero.
 * @param {Profile} profile @param {Random} random @param {number} d @param {string} date
 * @returns {SignalMap}
 */
function signalValues(profile, random, d, date) {
  const u = profile.usual;
  const p = profile.decline(d);
  const weekend = isWeekend(date);
  /** @type {SignalMap} */
  const values = {
    sleepMinutes: Math.round(random.normal(u.sleep + (weekend ? 10 : 0), 12)),
    steps: Math.round(Math.max(200, random.normal(u.steps * (1 - 0.75 * p), u.steps * 0.12))),
    meanHeartRate: Math.round(random.normal(u.hr + 4 * p, 2)),
    restingHeartRate: Math.round(random.normal(u.rhr + 6 * p, 1.5)),
    hrv: Math.round(Math.max(10, random.normal(u.hrv - 14 * p, 3))),
    timeAtHomeMinutes: Math.round(clamp(random.normal(u.home + (weekend ? 60 : 0) + 420 * p, 45), 240, 1440)),
    movementRadiusKm: round1(Math.max(0.2, random.normal(u.radius * (1 - 0.8 * p), u.radius * 0.2))),
    calendarBusyMinutes: weekend ? 15 * random.int(0, 2) : 15 * Math.max(0, Math.round(random.normal(u.busy, 45) / 15)),
    lateNightScreenMinutes: Math.round(Math.max(0, random.normal(u.screen + 70 * p, 6))),
  };
  Object.assign(values, profile.overrides?.(d) ?? {});
  const present = profile.signalsPresent(d, random);
  if (present === "none") for (const key of SIGNAL_KEYS) values[key] = null;
  if (present === "some") {
    // A partial day: the watch was off for part of it, so the watch Signals are missing.
    values.hrv = null;
    values.restingHeartRate = null;
    if (random.chance(0.5)) values.sleepMinutes = null;
  }
  return values;
}

const SUGGESTION_DETAILS = /** @type {Record<SuggestionKind, string>} */ ({
  walk: "A fifteen-minute walk around the block before dinner.",
  nature: "Half an hour in the park by the shore.",
  music: "Put on an album you used to love and listen to the whole side.",
  social_call: "A short call with your sister this evening.",
  breathing: "Five minutes of slow breathing before bed.",
  class_activity: "Try the Thursday evening yoga class at the community centre.",
  daylight: "Step outside in daylight around midday, even for ten minutes.",
});

const SUGGESTION_NAMES = /** @type {Record<SuggestionKind, string>} */ ({
  walk: "the walk",
  nature: "the time in the park",
  music: "the music",
  social_call: "the call",
  breathing: "the breathing exercise",
  class_activity: "the class",
  daylight: "the time in daylight",
});

const THEMES = {
  well: ["a walk outside", "work going steadily", "time with friends", "cooking", "weekend plans", "family", "music"],
  low: ["low energy", "staying in", "broken sleep", "cancelled plans", "feeling flat", "work piling up"],
};

const CUES = {
  well: [{ label: "bright tone", heard: "Laughed while talking about the weekend" }],
  low: [
    { label: "flat tone", heard: "Short answers with long pauses" },
    { label: "hesitation", heard: "Paused for a while before talking about sleep" },
    { label: "quiet voice", heard: "Spoke more softly than earlier Check-ins" },
  ],
};

const QUOTES = [
  "I just haven't had the energy to go out.",
  "Nights have been really broken this week.",
  "I keep cancelling things and then feeling bad about it.",
];

/** @param {number | null} minutes */
function sleepLine(minutes) {
  if (minutes === null) return "No sleep data for last night.";
  const hours = Math.round(minutes / 60);
  return hours <= 3 ? "Slept under three hours last night." : `Slept about ${hours} hours last night.`;
}

/** @param {Suggestion} suggestion */
function previousOutcomeLine(suggestion) {
  const name = SUGGESTION_NAMES[suggestion.kind];
  if (suggestion.status === "declined") return null;
  if (suggestion.tried === false) return `Did not try ${name} this time.`;
  if (suggestion.tried === null || suggestion.felt === null) return null;
  if (suggestion.felt >= 4) return `Tried ${name} and felt better afterwards.`;
  if (suggestion.felt === 3) return `Tried ${name}; felt about the same.`;
  return `Tried ${name}, but it did not help much.`;
}

/**
 * The Outcome score once the Patient has answered: not tried is a small negative value; otherwise
 * 0.7 x the feeling (centred on 3, scaled to plus or minus 1) plus 0.3 x that day's oriented steps
 * comparison with Baseline, clamped to plus or minus 1. A missing comparison adds nothing.
 * @param {boolean} tried @param {number | null} felt @param {number | null} objectiveChange
 */
export function outcomeScore(tried, felt, objectiveChange) {
  if (!tried) return NOT_TRIED_OUTCOME;
  const feeling = felt === null ? 0 : (felt - 3) / 2;
  return clamp(0.7 * feeling + 0.3 * (objectiveChange ?? 0), -1, 1);
}

/**
 * @param {keyof typeof PROFILES} profileKey
 * @param {SeedOptions} options
 * @returns {DemoPatient}
 */
export function makePatient(profileKey, options) {
  const profile = PROFILES[profileKey];
  if (!profile) throw new Error(`Unknown profile: ${profileKey}`);
  const { today } = options;
  const nowMillis = options.nowMillis ?? zonedMillis(today, 12, 0);
  const seed = options.seed ?? DEFAULT_SEED;
  const clinicianEmail = options.clinicianEmail ?? DEMO_CLINICIAN_EMAIL;
  const random = createRandom(hashString(`${seed}:${profile.key}`));
  const dateOf = (/** @type {number} */ d) => addDays(today, -d);
  const at = (/** @type {number} */ d, /** @type {number} */ hour, /** @type {number} */ minute) =>
    zonedMillis(dateOf(d), hour, minute, DEMO_TIME_ZONE);

  // The sharing stamp: every document is stamped with whether the Patient was sharing when it was
  // saved. Demo Patients share throughout, except during a profile's sharing pause.
  const pause = profile.sharingPause
    ? {
        from: at(profile.sharingPause.from.d, profile.sharingPause.from.hour, profile.sharingPause.from.minute),
        to: at(profile.sharingPause.to.d, profile.sharingPause.to.hour, profile.sharingPause.to.minute),
      }
    : null;
  const sharedAt = (/** @type {number} */ millis) => pause === null || millis < pause.from || millis >= pause.to;

  // Daily Signal records: 42 days ending today, compared with Baseline by the shared rule.
  const days = [];
  for (let d = DAILY_RECORDS - 1; d >= 0; d--) {
    const date = dateOf(d);
    days.push({ d, date, values: signalValues(profile, random, d, date) });
  }
  // Aim last night's sleep at a set distance from the Baseline on the days the profile names.
  for (const day of days) {
    const target = profile.sleepTargets?.[day.d];
    if (target === undefined || day.values.sleepMinutes === null) continue;
    const baseline = baselineFor(
      days.map((x) => ({ date: x.date, value: x.values.sleepMinutes })),
      day.date,
    );
    if (baseline) day.values.sleepMinutes = Math.round(baseline.centre + target * baseline.spread);
  }
  const comparisons = dailyComparisons(days);
  // The phone's morning job creates each day's record at about 07:10.
  /** @type {Entry<DailyDoc>[]} */
  const daily = days.map((day, i) => ({
    id: day.date,
    data: {
      date: day.date,
      values: day.values,
      vsBaseline: comparisons[i].vsBaseline,
      composite: comparisons[i].composite,
      demoOverride: false,
      sharedWithClinician: sharedAt(at(day.d, 7, 10)),
    },
  }));
  const valuesByD = new Map(days.map((day, i) => [day.d, { values: day.values, vsBaseline: comparisons[i].vsBaseline }]));

  // Check-ins in the evening, each with a Summary and one Suggestion. The Outcome of a Suggestion
  // is given at the next Check-in; the latest one is still open.
  /** @type {Entry<CheckIn>[]} */
  const checkIns = [];
  /** @type {Entry<Summary>[]} */
  const summaries = [];
  /** @type {Entry<Suggestion>[]} */
  const suggestions = [];
  for (let d = DAILY_RECORDS - 1; d >= 1; d--) {
    if (!profile.checksIn(d, random)) continue;
    const date = dateOf(d);
    const ratings = profile.ratings(d, random);
    const low = (ratings.mood ?? 3) <= 2;
    const startedAtMillis = at(d, random.int(18, 20), random.int(0, 59)) + random.int(0, 59) * 1000;
    const endedAtMillis = startedAtMillis + random.int(150, 330) * 1000;
    const tone = low ? "low" : "well";
    /** @type {VoiceCue[]} */
    const voiceCues =
      low || random.chance(0.15)
        ? [{ ...random.pick(CUES[tone]), intensity: low ? random.int(2, 4) : random.int(1, 2) }]
        : [];
    const checkInId = `checkin-${date}`;
    checkIns.push({
      id: checkInId,
      data: { id: checkInId, startedAtMillis, endedAtMillis, ...ratings, voiceCues, crisis: false, sharedWithClinician: sharedAt(startedAtMillis) },
    });

    // Answer the previous Suggestion now, if the Patient accepted it.
    const previous = suggestions.at(-1)?.data ?? null;
    if (previous && previous.status === "accepted") {
      const previousDate = previous.id.slice("suggestion-".length);
      const previousD = DAILY_RECORDS - 1 - days.findIndex((day) => day.date === previousDate);
      const stepsChange = valuesByD.get(previousD)?.vsBaseline.steps ?? null;
      previous.tried = random.chance(low ? 0.45 : 0.75);
      previous.felt = previous.tried ? clamp(random.int(3, 5) - (low ? 1 : 0), 1, 5) : null;
      previous.objectiveChange = oriented("steps", stepsChange);
      previous.outcomeScore = outcomeScore(previous.tried, previous.felt, previous.objectiveChange);
    }

    const kind = random.pick(profile.suggestionKinds);
    const status = random.chance(0.2) ? "declined" : "accepted";
    const suggestionId = `suggestion-${date}`;
    suggestions.push({
      id: suggestionId,
      data: {
        id: suggestionId,
        kind,
        details: SUGGESTION_DETAILS[kind],
        suggestedAtMillis: startedAtMillis + 120_000,
        status,
        booked: status === "accepted" && (kind === "walk" || kind === "class_activity" || kind === "nature") && random.chance(0.5),
        tried: null,
        felt: null,
        objectiveChange: null,
        outcomeScore: null,
        sharedWithClinician: sharedAt(startedAtMillis + 120_000),
      },
    });

    const themeCount = random.int(1, 3);
    /** @type {string[]} */
    const themes = [];
    while (themes.length < themeCount) {
      const theme = random.pick(THEMES[tone]);
      if (!themes.includes(theme)) themes.push(theme);
    }
    const summaryAtMillis = endedAtMillis + random.int(4, 9) * 1000;
    summaries.push({
      id: checkInId,
      data: {
        checkInId,
        createdAtMillis: summaryAtMillis,
        ...ratings,
        sleepLine: sleepLine(valuesByD.get(d)?.values.sleepMinutes ?? null),
        themes,
        voiceCues,
        suggestion: status === "accepted" ? SUGGESTION_DETAILS[kind] : null,
        previousOutcome: previous ? previousOutcomeLine(previous) : null,
        quotes: low && random.chance(0.6) ? [random.pick(QUOTES)] : [],
        sharedWithClinician: sharedAt(summaryAtMillis),
      },
    });
  }

  // Attention flags, raised by the phone's morning daily job on the first morning a rule holds. A
  // kind with an open flag is not raised again, and none is cleared, so the Patient's level is the
  // highest of them and the reasons run from the highest level, newest first. Only flags raised
  // while sharing count toward the level (a flag raised in a sharing pause never does).
  /** @type {Entry<Flag>[]} */
  const flags = [];
  for (let i = 0; i < days.length; i++) {
    const { d, date, values } = days[i];
    const jobAtMillis = at(d, 7, 10);
    if (jobAtMillis > nowMillis) break;
    const drafts = draftsFor({
      sleepMinutes: values.sleepMinutes,
      sleepOriented: comparisons.slice(0, i + 1).map((c) => oriented("sleepMinutes", c.vsBaseline.sleepMinutes)),
      composites: comparisons.slice(0, i + 1).map((c) => c.composite),
      moods: checkIns.filter((c) => (c.data.endedAtMillis ?? 0) < jobAtMillis).map((c) => c.data.mood),
    });
    // The stamp is decided at the job's start; a pause starts and ends at 06:00, before any job.
    const shared = sharedAt(jobAtMillis);
    for (const draft of drafts) {
      // A kind already open with the same stamp is not raised again: a flag the Clinician cannot
      // see never stops one they can.
      if (flags.some((f) => f.data.kind === draft.kind && f.data.clearedAtMillis === null && f.data.sharedWithClinician === shared)) continue;
      flags.push({
        id: `${draft.kind}-${date}`,
        data: { ...draft, raisedAtMillis: jobAtMillis + random.int(0, 300) * 1000, clearedAtMillis: null, sharedWithClinician: shared },
      });
    }
  }
  const rank = { green: 0, amber: 1, red: 2 };
  const open = flags
    .map((f) => f.data)
    .filter((f) => f.clearedAtMillis === null && f.sharedWithClinician)
    .sort((a, b) => rank[b.level] - rank[a.level] || b.raisedAtMillis - a.raisedAtMillis);

  const tmsEndDate = dateOf(TMS_END_DAYS_AGO);
  const consentMillis = at(TMS_END_DAYS_AGO - 1, 10, 0);
  // Sharing last changed when the Patient shared again after a pause, if there was one.
  const sharingMillis = pause?.to ?? consentMillis;
  /** @type {Entry<Consent>[]} */
  const consents = [...SIGNAL_KEYS, ...CONSENT_PURPOSES].map((subject) => ({
    id: subject,
    data: {
      subject: /** @type {Consent["subject"]} */ (subject),
      granted: true,
      changedAtMillis: subject === "sharing" ? sharingMillis : consentMillis,
    },
  }));

  const visitDate = dateOf(VISIT_DAYS_AGO);
  /** @type {Entry<Visit>[]} */
  const visits = [{ id: `visit-${visitDate}`, data: { date: visitDate, questionnaire: "phq9", score: profile.visitScore } }];

  const lastCheckIn = checkIns.at(-1)?.data ?? null;
  /** @type {PatientDoc} */
  const patient = {
    displayName: profile.displayName,
    clinicianEmail,
    intakeHighlights: profile.intakeHighlights,
    tmsEndDate,
    flagLevel: open[0]?.level ?? "green",
    flagReasons: open.map((f) => f.reason),
    quietHoursStart: 21,
    quietHoursEnd: 9,
    lastSeenAtMillis: Math.min(at(profile.lastSeen.d, profile.lastSeen.hour, profile.lastSeen.minute), nowMillis),
    lastCheckInAtMillis: lastCheckIn?.endedAtMillis ?? null,
    healthSource: "synthetic",
    synthetic: true,
    sharingConsent: "granted",
    sharingChangedAtMillis: sharingMillis,
  };

  return { id: profile.id, profile: profile.key, patient, daily, consents, checkIns, summaries, suggestions, flags, visits };
}

/**
 * The three Demo Patients: steady, declining, sparse.
 * @param {SeedOptions} options
 * @returns {DemoPatient[]}
 */
export function generateDemoPatients(options) {
  return PROFILE_ORDER.map((key) => makePatient(key, options));
}

/**
 * Today's date in the demo time zone, for the CLI default.
 * @param {number} nowMillis
 */
export function demoToday(nowMillis) {
  return dateInZone(nowMillis, DEMO_TIME_ZONE);
}
