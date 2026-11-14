// The three Demo Patients, and the live demo Patient's profile (live-profile.js). Every value is
// invented; no open dataset is used.
//
// A profile describes a Patient's shape: their usual Signal values, how those change, which days
// they check in and how they rate their day. The generator (generate.js) turns a profile into
// documents and places the Attention flags the history raises (flags.js). `d` is always the
// number of days before today (0 = today, 41 = the first daily record, 42 = the TMS end date).

import { live } from "./live-profile.js";

/** @typedef {import("../../functions/src/types.ts").SuggestionKind} SuggestionKind */
/** @typedef {import("../../functions/src/types.ts").FlagKind} FlagKind */
/** @typedef {import("../../functions/src/types.ts").VoiceCue} VoiceCue */
/** @typedef {import("./random.js").Random} Random */

/**
 * @typedef {object} UsualValues
 * @property {number} sleep minutes
 * @property {number} steps
 * @property {number} hr mean heart rate
 * @property {number} rhr resting heart rate
 * @property {number} hrv
 * @property {number} home time at home, minutes
 * @property {number} radius movement radius, km
 * @property {number} busy calendar busy minutes on a weekday
 * @property {number} screen late-night screen minutes
 */

/**
 * @typedef {object} Ratings
 * @property {number | null} mood
 * @property {number | null} energy
 * @property {number | null} sleepQuality
 */

/**
 * How far into a decline a day is: 0 before it starts, rising to 1 today.
 * @typedef {(d: number) => number} Shape
 */

/**
 * One Check-in of a profile that tells a fixed story: what the Patient rated and talked about,
 * the Suggestion made, and what they said about it at the next Check-in.
 * @typedef {object} ScriptedCheckIn
 * @property {Ratings} ratings
 * @property {string[]} themes at most four, each a few words
 * @property {string[]} [quotes] the Patient's own words, at most three
 * @property {VoiceCue[]} [voiceCues] observations, never a diagnosis
 * @property {string} [sleepNote] added to the sleep line, in the Patient's terms
 * @property {{ kind: SuggestionKind, details: string, status: "accepted" | "declined" }} suggestion
 * @property {{ tried: boolean, felt: number | null, said: string }} [outcome] the answer given at the
 *   next Check-in; none for a declined Suggestion and for the latest one, which is still open
 */

/**
 * @typedef {object} Profile
 * @property {"steady" | "declining" | "sparse" | "live"} key
 * @property {string} id stable Patient document id (the live Patient's comes from its auth uid)
 * @property {string} displayName
 * @property {string} intakeHighlights a Demo Patient's begins "Synthetic demo data"
 * @property {boolean} [synthetic] false for the live demo Patient, a real account; default true
 * @property {boolean} [mockHistory] mark every document as mock history, so it can be found and
 *   reset without touching what the app writes later: daily records get `demoOverride: true`, and
 *   every other id starts with `demo-` (see MOCK_ID_PREFIX)
 * @property {number} visitScore PHQ-9 score at the Visit 21 days ago
 * @property {number} [tmsEndVisitScore] PHQ-9 score at a Visit on the TMS end date, if there was one
 * @property {UsualValues} usual
 * @property {Shape} decline
 * @property {(d: number) => Partial<Record<string, number>>} [overrides] fixed values on given days
 * @property {Record<number, number>} [sleepTargets] by day: last night's sleep is set to this many
 *   spreads from the Baseline, so a decline reads the same whatever the seed
 * @property {(d: number, random: Random) => "all" | "some" | "none"} signalsPresent
 * @property {(d: number, random: Random) => boolean} checksIn
 * @property {(d: number, random: Random) => Ratings} ratings
 * @property {readonly SuggestionKind[]} [suggestionKinds] weighted by repetition; not used with a script
 * @property {Record<number, ScriptedCheckIn>} [script] by day: the Check-ins of a fixed story. With a
 *   script, its days are the Check-in days and everything said comes from it.
 * @property {{ kind: FlagKind, at: Moment }[]} [followUps] the Clinician cleared the open flag of
 *   this kind at this time, after following up
 * @property {{ d: number, hour: number, minute: number }} lastSeen
 * @property {{ from: Moment, to: Moment }} [sharingPause] a time in the past when the Patient did
 *   not share: withdrew at `from` and shared again at `to`. What was saved in between is stamped
 *   `sharedWithClinician: false`, so the Clinician never sees it.
 */

/** @typedef {{ d: number, hour: number, minute: number }} Moment */

/** @param {Random} random @param {number[]} weights index i is rating i + 1 */
function weighted(random, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = random.next() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll < 0) return i + 1;
  }
  return weights.length;
}

/** A rating that is sometimes skipped. @param {Random} random @param {number} value @param {number} pSkip */
function maybe(random, value, pSkip) {
  return random.chance(pSkip) ? null : value;
}

/** @type {Profile} */
const steady = {
  key: "steady",
  id: "demo-steady",
  displayName: "Aino (demo)",
  intakeHighlights:
    "Synthetic demo data. Invented profile, not a real person. Finished a course of TMS six weeks ago " +
    "with a good response. Works part time and walks most days. Sleep has been regular since treatment. " +
    "Values routine, time outdoors and weekly calls with a sister.",
  visitScore: 5,
  usual: { sleep: 445, steps: 8400, hr: 69, rhr: 57, hrv: 54, home: 820, radius: 7.5, busy: 210, screen: 8 },
  decline: () => 0,
  signalsPresent: () => "all",
  checksIn: (d, random) => d >= 1 && !random.chance(0.2),
  ratings: (_d, random) => ({
    mood: maybe(random, weighted(random, [0, 0, 1, 2, 1]), 0.04),
    energy: maybe(random, weighted(random, [0, 0, 2, 2, 1]), 0.04),
    sleepQuality: maybe(random, weighted(random, [0, 0, 1, 3, 1]), 0.06),
  }),
  suggestionKinds: ["walk", "walk", "nature", "nature", "social_call", "music", "daylight", "class_activity"],
  lastSeen: { d: 0, hour: 7, minute: 16 },
  // Stopped sharing for three days early on, then shared again: those days' records stay hidden
  // from the Clinician (a gap in the Signals and Summaries), the rest is visible.
  sharingPause: { from: { d: 30, hour: 6, minute: 0 }, to: { d: 27, hour: 6, minute: 0 } },
};

// Declines over the last ten days: shorter sleep, fewer steps, more time at home, lower ratings.
// Poor sleep, drift and low mood raise amber flags first; a night under three hours raises red.
/** @type {Shape} */
const lastTenDays = (d) => (d <= 9 ? (10 - d) / 10 : 0);

/** Moods for the declining Patient's last Check-ins, by day. */
const DECLINING_MOODS = /** @type {Record<number, number>} */ ({ 9: 3, 8: 3, 7: 2, 6: 2, 5: 2, 4: 2, 3: 1, 2: 2 });

/** @type {Profile} */
const declining = {
  key: "declining",
  id: "demo-declining",
  displayName: "Mikko (demo)",
  intakeHighlights:
    "Synthetic demo data. Invented profile, not a real person. Finished a course of TMS six weeks ago. " +
    "Lives alone and works from home. Earlier low periods began with broken sleep and staying in. " +
    "Finds walks by the sea and music helpful.",
  visitScore: 9,
  usual: { sleep: 430, steps: 7600, hr: 73, rhr: 60, hrv: 46, home: 900, radius: 6, busy: 240, screen: 14 },
  decline: lastTenDays,
  // Below the usual but short of the red line (2.5 spreads) until the night under three hours.
  sleepTargets: { 9: -0.6, 8: -1.25, 7: -1.4, 6: -1.6, 5: -1.7, 4: -1.85, 3: -1.95, 2: -2.05 },
  overrides: (d) => (d === 1 ? { sleepMinutes: 165 } : d === 0 ? { sleepMinutes: 205 } : {}),
  signalsPresent: () => "all",
  checksIn: (d, random) => (d <= 9 ? d >= 2 : !random.chance(0.15)),
  ratings: (d, random) => {
    if (d <= 9) {
      const mood = DECLINING_MOODS[d] ?? 2;
      return { mood, energy: Math.max(1, mood - random.int(0, 1)), sleepQuality: d <= 6 ? 1 : 2 };
    }
    return {
      mood: maybe(random, weighted(random, [0, 0, 2, 3, 1]), 0.04),
      energy: maybe(random, weighted(random, [0, 1, 2, 2, 0]), 0.04),
      sleepQuality: maybe(random, weighted(random, [0, 0, 2, 2, 1]), 0.06),
    };
  },
  suggestionKinds: ["walk", "walk", "nature", "music", "music", "breathing", "daylight", "social_call"],
  lastSeen: { d: 0, hour: 7, minute: 16 },
};

/** Days before today with a Check-in, oldest first, and the mood given at each. */
const SPARSE_CHECK_INS = /** @type {Record<number, number>} */ ({ 38: 4, 31: 3, 24: 3, 16: 3, 9: 2, 5: 2, 2: 2 });
/** Days with no health Signals at all (watch not worn, phone off). */
const SPARSE_EMPTY_DAYS = new Set([40, 35, 34, 29, 27, 22, 21, 20, 14, 12, 7, 6, 1, 0]);

// Rarely checks in: about once a week, with days of missing data stored as null.
/** @type {Profile} */
const sparse = {
  key: "sparse",
  id: "demo-sparse",
  displayName: "Sara (demo)",
  intakeHighlights:
    "Synthetic demo data. Invented profile, not a real person. Finished a course of TMS six weeks ago. " +
    "Shift work makes days irregular, and she often leaves the watch at home. Prefers short, " +
    "practical suggestions and time in daylight.",
  visitScore: 11,
  usual: { sleep: 405, steps: 5300, hr: 76, rhr: 63, hrv: 39, home: 980, radius: 3.5, busy: 120, screen: 28 },
  decline: () => 0,
  signalsPresent: (d, random) => (SPARSE_EMPTY_DAYS.has(d) ? "none" : random.chance(0.25) ? "some" : "all"),
  checksIn: (d) => d in SPARSE_CHECK_INS,
  ratings: (d, random) => {
    const mood = SPARSE_CHECK_INS[d] ?? 3;
    return {
      mood,
      energy: maybe(random, Math.max(1, mood - random.int(0, 1)), 0.15),
      sleepQuality: maybe(random, random.int(2, 4), 0.3),
    };
  },
  suggestionKinds: ["daylight", "daylight", "walk", "breathing", "music"],
  lastSeen: { d: 1, hour: 7, minute: 16 },
};

export const PROFILES = Object.freeze({ steady, declining, sparse, live });
