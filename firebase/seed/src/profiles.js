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
 * What a Patient's Check-ins are about, in their own life: the places, people and music the
 * Companion can draw on for a Suggestion. "well" is used at mood 3 and up, "low" at 2 and under.
 * @typedef {object} Story
 * @property {{ well: string[], low: string[] }} themes two to four words each, at least four per tone
 * @property {{ well: string[], low: string[] }} quotes the Patient's own words, at most 200 characters
 * @property {Partial<Record<SuggestionKind, string[]>>} suggestions one sentence each, for every
 *   kind in the profile's suggestionKinds
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
 * @property {string} intakeHighlights begins "Synthetic demo data"
 * @property {{ label: string, latitude: number, longitude: number }} [location] an example address
 *   near where the story is set (a public landmark's coordinates), for place searches. None for the
 *   live demo Patient: a live Patient's location stays on their phone.
 * @property {boolean} [synthetic] false for the live demo Patient, a real account; default true
 * @property {boolean} [seededHistory] mark every document as seeded history, so it can be found and
 *   reset without touching what the app writes later: daily records get `demoOverride: true`, and
 *   every other id starts with `demo-` (see SEED_ID_PREFIX)
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
 * @property {Story} [story] what the Check-ins are about; not used with a script
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
    "with a good response. Lives in Lauttasaari, Helsinki, works part time in a bookshop and walks the " +
    "island's shore path most days. Sleep has been regular since treatment. Values routine, time " +
    "outdoors and a weekly call with her sister Liisa in Tampere. Sings in a choir on Thursdays. Likes " +
    "quiet piano and Nordic folk: Ólafur Arnalds, Joni Mitchell, Värttinä. Earlier low periods began " +
    "with skipping walks and choir. Favourite places: the Lauttasaari shore, Seurasaari and the Winter " +
    "Garden in Töölö.",
  location: { label: "An apartment by Lauttasaari metro station, Helsinki", latitude: 60.1594, longitude: 24.8786 },
  visitScore: 5,
  usual: { sleep: 445, steps: 8400, hr: 69, rhr: 57, hrv: 54, home: 820, radius: 7.5, busy: 210, screen: 8 },
  decline: () => 0,
  signalsPresent: () => "all",
  checksIn: (d, random) => d >= 1 && !random.chance(0.2),
  // Progress since treatment: mostly threes in the first two weeks, fours and fives after.
  ratings: (d, random) => ({
    mood: maybe(random, weighted(random, d > 27 ? [0, 0, 3, 2, 0] : [0, 0, 1, 3, 2]), 0.04),
    energy: maybe(random, weighted(random, [0, 0, 2, 2, 1]), 0.04),
    sleepQuality: maybe(random, weighted(random, [0, 0, 1, 3, 1]), 0.06),
  }),
  suggestionKinds: ["walk", "walk", "nature", "nature", "social_call", "music", "daylight", "class_activity"],
  story: {
    themes: {
      well: [
        "shore path walk",
        "choir rehearsal",
        "call with Liisa",
        "busy bookshop day",
        "cooking for friends",
        "Sunday sauna",
        "planning a weekend trip",
        "sleeping well",
        "new choir piece",
        "lunch break outside",
        "reading before bed",
        "Seurasaari with a friend",
      ],
      low: ["tired after work", "dark afternoons", "skipped a walk", "quiet weekend"],
    },
    quotes: {
      well: [
        "I walked the whole shore path today and didn't check the time once.",
        "Choir was lovely. I'd forgotten how much I like hearing the altos behind me.",
        "Liisa and I talked for an hour. She wants to visit in December.",
        "I slept straight through again. It still surprises me.",
        "The shop was busy and I was tired afterwards, but the good kind of tired.",
        "It gets dark so early now, so I go out at lunch while there's light.",
        "I'm reading before bed again instead of lying there thinking.",
        "I said yes to dinner on Friday without talking myself out of it first.",
      ],
      low: ["I skipped the walk today. It was dark by the time I got home.", "A quiet day. Nothing wrong, just flat."],
    },
    suggestions: {
      walk: [
        "Walk the Lauttasaari shore path to Kasinonranta before dinner.",
        "A twenty-minute loop over the bridge towards Lapinlahti and back.",
        "Walk to the bookshop tomorrow instead of taking the metro.",
      ],
      nature: [
        "An hour on Seurasaari on Saturday, once around the island path.",
        "Half an hour by the water at Vattuniemi with a thermos.",
        "Visit the Winter Garden in Töölö and stay among the plants for a while.",
      ],
      social_call: [
        "Call Liisa this evening and tell her about the new choir piece.",
        "Ask a friend from choir for coffee after Thursday's rehearsal.",
      ],
      music: [
        "Put on Ólafur Arnalds' Island Songs while you cook tonight.",
        "Listen to Joni Mitchell's Blue from start to finish this evening.",
        "Sing through the choir piece once at home, just for yourself.",
      ],
      daylight: [
        "Take the lunch break outside on the bench by the bookshop, around noon.",
        "Morning coffee by the window with the curtains open, before work.",
      ],
      class_activity: [
        "Go to Thursday's choir rehearsal, even if only for the first half.",
        "Try the Tuesday evening yoga class at the sports hall in Lauttasaari.",
      ],
    },
  },
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
    "Lives alone in Kallio, Helsinki, and works from home as a translator. Earlier low periods began " +
    "with broken sleep, late nights on the phone and staying in. Finds walks by the sea helpful, " +
    "usually Tokoinranta or Kaivopuisto, and music: plays guitar, and listens to Sigur Rós, Radiohead " +
    "and Bill Evans. Close to his friend Jussi, who he meets for coffee by Karhupuisto, and calls his " +
    "mother in Oulu on Sundays. Tends to cancel plans when low and feels guilty afterwards.",
  location: { label: "An apartment by Karhupuisto, Kallio, Helsinki", latitude: 60.1842, longitude: 24.9531 },
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
  story: {
    themes: {
      well: [
        "morning sea walk",
        "translation deadline",
        "playing guitar",
        "coffee with Jussi",
        "call with mother",
        "cooking at home",
        "new translation project",
        "Sunday in Kaivopuisto",
        "sleeping okay",
        "working by the window",
      ],
      low: [
        "broken sleep",
        "staying in",
        "guitar untouched",
        "cancelled on Jussi",
        "awake at four",
        "phone in bed",
        "work piling up",
        "feeling flat",
        "skipped the walk",
        "not hungry",
      ],
    },
    quotes: {
      well: [
        "I got down to the water before work. It sets the day up differently.",
        "Jussi and I sat by Karhupuisto for an hour. It was easy.",
        "I picked up the guitar again. My fingers hurt, in a good way.",
        "The new project is big, but I know how to start it.",
        "I called my mother and we actually laughed about something.",
        "I put a record on instead of the phone and fell asleep before it ended.",
      ],
      low: [
        "I was awake at four again, just looking at the ceiling.",
        "I haven't been outside since Tuesday, I think.",
        "I told Jussi I was busy. I wasn't busy.",
        "The guitar is right there and I can't make myself pick it up.",
        "I keep cancelling things and then feeling bad about it.",
        "Work is piling up and I just move the files around.",
        "I don't really feel sad. I don't feel much of anything.",
        "I only slept a couple of hours, and then the day just went.",
      ],
    },
    suggestions: {
      walk: [
        "Walk down to Tokoinranta and along the water to Hakaniemi, fifteen minutes.",
        "Once around Töölönlahti after the last work call.",
        "Just to Karhupuisto and back, ten minutes, before it gets dark.",
      ],
      nature: [
        "Take the tram to Kaivopuisto and sit by the sea for half an hour.",
        "Walk the Lammassaari boardwalk through the reeds on Saturday.",
      ],
      music: [
        "Play guitar for ten minutes, anything at all, with no goal.",
        "Put on Bill Evans' Waltz for Debby instead of the phone before bed.",
        "Listen to Sigur Rós' Ágætis byrjun with headphones on the sofa.",
      ],
      breathing: [
        "Five slow breaths at the open window before bed, phone in the other room.",
        "Four counts in, six counts out, for three minutes when the night gets long.",
      ],
      daylight: [
        "Move the chair to the window and work in daylight until noon.",
        "Step outside for ten minutes at midday, before the light goes.",
      ],
      social_call: [
        "Text Jussi and ask about coffee by Karhupuisto this week.",
        "Call your mother in Oulu on Sunday, even briefly.",
      ],
    },
  },
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
    "Lives in Vallila, Helsinki, and drives trams in shifts, so days are irregular, and she often " +
    "leaves the watch at home. Prefers short, practical suggestions and time in daylight, which is " +
    "scarce on early and late shifts. Likes the Vallila allotment gardens, Kumpula Botanic Garden and " +
    "a bench in the sun at Arabianranta. Listens to Sade, Robyn and Alma on the way home. Her friend " +
    "Noora lives nearby. Low periods come with night shifts, skipped meals and scrolling in bed.",
  location: { label: "An apartment in Vallila, Helsinki", latitude: 60.1944, longitude: 24.9569 },
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
  story: {
    themes: {
      well: [
        "early shift done",
        "lunch outside",
        "day off",
        "coffee with Noora",
        "allotment gardens walk",
        "sun at Arabianranta",
        "cooked a proper meal",
        "music going home",
      ],
      low: [
        "night shift week",
        "slept through daylight",
        "skipped meals",
        "scrolling in bed",
        "forgot the watch",
        "too tired to cook",
        "no daylight today",
        "days blurring together",
      ],
    },
    quotes: {
      well: [
        "Early shift, so I was out by two and actually saw the sun.",
        "Noora dragged me out for coffee. I'm glad she did.",
        "Day off. I walked through the allotment gardens and nobody needed anything from me.",
        "Ten minutes on that bench did more than I expected.",
      ],
      low: [
        "It was dark when I left and dark when I got home.",
        "I ate a sandwich at the terminus and that was dinner.",
        "I meant to sleep, and then it was two o'clock and I was still on my phone.",
        "I keep forgetting the watch. Honestly, I keep forgetting most things.",
        "Short ideas work. Anything longer and I won't do it.",
      ],
    },
    suggestions: {
      daylight: [
        "Ten minutes on the sunny bench at Arabianranta before the late shift.",
        "Eat lunch outside at the depot instead of in the break room.",
        "Get off one stop early and walk the last bit in daylight.",
      ],
      walk: [
        "A short loop through the Vallila allotment gardens after waking up.",
        "Walk to Kumpula Botanic Garden and back on the day off.",
      ],
      breathing: [
        "Three slow breaths at the terminus before the tram turns around.",
        "Two minutes of slow breathing in bed instead of scrolling.",
      ],
      music: [
        "Put on Sade's Diamond Life on the way home from the late shift.",
        "Robyn's Body Talk, loud, while making breakfast before the shift.",
      ],
    },
  },
  lastSeen: { d: 1, hour: 7, minute: 16 },
};

export const PROFILES = Object.freeze({ steady, declining, sparse, live });
