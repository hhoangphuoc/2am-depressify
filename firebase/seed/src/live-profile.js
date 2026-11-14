// The live demo Patient's profile: six weeks of invented history for one real Patient account, so the
// Companion has context to draw on and "what seems to help" has something to learn from. Every
// value is invented. It is data for the shared generator (generate.js), like the Demo Patients.
//
// The story (d = days before today; 42 is the TMS end date):
//   - A designer in a small studio who moved city two years ago. Weeks 1 and 2 after the course:
//     settling back in, cycling, taking photos on walks, nearly daily Check-ins.
//   - Days 31 to 29: a deadline week with short nights. A poor-sleep flag is raised on day 29; the
//     Clinician follows up and clears it on day 27. Visit on day 21 (PHQ-9 9).
//   - A steady stretch, Check-ins every two or three days.
//   - The last nine days drift: a new project, late evenings on the phone, shorter sleep, fewer
//     steps, more time at home. A new poor-sleep flag is open (and drift, when the Signals say so):
//     the Patient is amber on the dashboard.
//   - What helps, as the Patient tells it: morning daylight, walks and time in nature (felt better);
//     music a little; calls with friends are mixed; the breathing exercise is mostly not tried.
//   - Yesterday's Check-in ended with a daylight Suggestion the Patient accepted. It has no Outcome
//     yet, so the next Check-in asks how it went.

/** @typedef {import("./profiles.js").Profile} Profile */
/** @typedef {import("./profiles.js").ScriptedCheckIn} ScriptedCheckIn */

const DETAILS = Object.freeze({
  lunchWalk: "A twenty-minute walk at lunch, with your camera in your pocket.",
  morningLight: "Ten minutes outside in morning daylight before opening the laptop.",
  shoreRide: "A slow ride out to the shore park at the weekend.",
  oldFriend: "A short call with an old friend this week.",
  breatheBeforeBed: "Five minutes of slow breathing before bed instead of scrolling.",
  albumSide: "Put on a favourite album and listen to one side with the phone in another room.",
});

const TIRED = { label: "tired voice", intensity: 2, heard: "Spoke slowly and yawned a few times" };
const FLAT = { label: "flat tone", intensity: 3, heard: "Short answers with long pauses before talking about work" };
const QUIET = { label: "quiet voice", intensity: 2, heard: "Spoke more softly than in earlier Check-ins" };
const BRIGHT = { label: "bright tone", intensity: 2, heard: "Laughed while describing the ride" };

/** @type {Readonly<Record<number, ScriptedCheckIn>>} */
export const LIVE_SCRIPT = {
  41: {
    ratings: { mood: 3, energy: 3, sleepQuality: 3 },
    themes: ["end of the clinic course", "back to work", "cycling"],
    quotes: ["It feels strange not having the daily appointments any more."],
    suggestion: { kind: "walk", details: DETAILS.lunchWalk, status: "accepted" },
    outcome: { tried: true, felt: 4, said: "Walked at lunch and took a few photos; felt lighter afterwards." },
  },
  40: {
    ratings: { mood: 4, energy: 3, sleepQuality: 4 },
    themes: ["photography", "work going steadily"],
    suggestion: { kind: "daylight", details: DETAILS.morningLight, status: "accepted" },
    outcome: { tried: true, felt: 5, said: "Went outside before work; said it made the morning easier." },
  },
  39: {
    ratings: { mood: 4, energy: 4, sleepQuality: 4 },
    themes: ["cycling", "weekend plans"],
    quotes: ["I might ride out to the coast on Saturday."],
    suggestion: { kind: "nature", details: DETAILS.shoreRide, status: "accepted" },
    outcome: { tried: true, felt: 5, said: "Rode to the shore park on Saturday and felt calm afterwards." },
  },
  38: {
    ratings: { mood: 4, energy: 3, sleepQuality: 4 },
    themes: ["missing friends", "moving city"],
    quotes: ["Most of my close friends are still back home."],
    suggestion: { kind: "social_call", details: DETAILS.oldFriend, status: "accepted" },
    outcome: { tried: true, felt: 4, said: "Called an old friend; it was good to catch up." },
  },
  36: {
    ratings: { mood: 3, energy: 3, sleepQuality: 3 },
    themes: ["work deadlines", "late evenings"],
    suggestion: { kind: "breathing", details: DETAILS.breatheBeforeBed, status: "accepted" },
    outcome: { tried: true, felt: 3, said: "Tried the breathing once; felt about the same." },
  },
  35: {
    ratings: { mood: 3, energy: 3, sleepQuality: 3 },
    themes: ["work deadlines", "evening phone habit"],
    quotes: ["I keep telling myself one more video, and then it's one o'clock."],
    sleepNote: "Fell asleep late after scrolling.",
    suggestion: { kind: "music", details: DETAILS.albumSide, status: "accepted" },
    outcome: { tried: true, felt: 4, said: "Listened to an old album; it helped to wind down a little." },
  },
  34: {
    ratings: { mood: 4, energy: 3, sleepQuality: 4 },
    themes: ["photography", "a good day at work"],
    voiceCues: [BRIGHT],
    suggestion: { kind: "daylight", details: "Take the camera out for ten minutes of morning light tomorrow.", status: "accepted" },
    outcome: { tried: true, felt: 5, said: "Took photos in the morning light and enjoyed it." },
  },
  32: {
    ratings: { mood: 3, energy: 2, sleepQuality: 2 },
    themes: ["work deadlines", "short sleep", "skipping lunch"],
    quotes: ["The launch is on Friday and everything is late."],
    voiceCues: [TIRED],
    suggestion: { kind: "breathing", details: "Five slow breaths at the desk when the deadline feels loud.", status: "accepted" },
    outcome: { tried: false, felt: null, said: "Did not try the breathing; worked straight through." },
  },
  31: {
    ratings: { mood: 2, energy: 2, sleepQuality: 2 },
    themes: ["work deadlines", "broken sleep", "feeling behind"],
    quotes: ["I was up till two finishing slides.", "I just want this week to be over."],
    voiceCues: [FLAT],
    sleepNote: "Up late finishing work.",
    suggestion: { kind: "music", details: "Ten minutes of calm music after work, before opening the laptop again.", status: "accepted" },
    outcome: { tried: true, felt: 3, said: "Put some music on after work; felt about the same." },
  },
  30: {
    ratings: { mood: 2, energy: 2, sleepQuality: 2 },
    themes: ["deadline week", "short sleep", "evening phone habit"],
    quotes: ["I scroll in bed because it's the only time that feels like mine."],
    voiceCues: [QUIET],
    suggestion: { kind: "social_call", details: "A quick message to a friend to plan something after the deadline.", status: "declined" },
  },
  28: {
    ratings: { mood: 3, energy: 2, sleepQuality: 4 },
    themes: ["deadline done", "catching up on sleep"],
    quotes: ["We shipped it, and I finally slept properly."],
    suggestion: { kind: "daylight", details: "A morning walk in daylight before work tomorrow.", status: "accepted" },
    outcome: { tried: true, felt: 4, said: "Walked in the morning light before work; felt more awake." },
  },
  26: {
    ratings: { mood: 4, energy: 3, sleepQuality: 4 },
    themes: ["call with the clinic", "sleep settling", "photography"],
    suggestion: { kind: "walk", details: DETAILS.lunchWalk, status: "accepted" },
    outcome: { tried: true, felt: 5, said: "Walked by the harbour at lunch and took photos; felt better afterwards." },
  },
  24: {
    ratings: { mood: 4, energy: null, sleepQuality: 4 },
    themes: ["cycling", "weekend plans"],
    quotes: ["The weather finally looks good for a ride."],
    suggestion: { kind: "nature", details: "A ride along the shore path on Sunday morning.", status: "accepted" },
    outcome: { tried: true, felt: 4, said: "Did the shore ride on Sunday; it cleared the head." },
  },
  22: {
    ratings: { mood: 4, energy: 4, sleepQuality: 4 },
    themes: ["photography", "morning routine"],
    suggestion: { kind: "daylight", details: DETAILS.morningLight, status: "accepted" },
    outcome: { tried: true, felt: 5, said: "Kept up the morning light; said it is becoming a habit." },
  },
  21: {
    ratings: { mood: 3, energy: 3, sleepQuality: 3 },
    themes: ["clinic visit", "missing friends"],
    quotes: ["The visit was fine. I just miss having people nearby."],
    suggestion: { kind: "social_call", details: "Call an old friend this weekend, even for ten minutes.", status: "accepted" },
    outcome: { tried: true, felt: 2, said: "Called a friend, but the call felt awkward and did not help much." },
  },
  19: {
    ratings: { mood: 4, energy: 3, sleepQuality: 4 },
    themes: ["cycling", "time outdoors"],
    voiceCues: [BRIGHT],
    suggestion: { kind: "nature", details: "An hour in the forest park with the camera on Saturday.", status: "accepted" },
    outcome: { tried: true, felt: 5, said: "Spent the morning in the forest park; felt calm and rested." },
  },
  16: {
    ratings: { mood: 4, energy: 4, sleepQuality: 4 },
    themes: ["cycling to work", "a good week"],
    quotes: ["Rode to work three days this week."],
    suggestion: { kind: "music", details: "Make a playlist for the ride to work.", status: "accepted" },
    outcome: { tried: true, felt: 4, said: "Made the playlist and enjoyed the rides more." },
  },
  13: {
    ratings: { mood: 3, energy: 3, sleepQuality: 3 },
    themes: ["busy week ahead", "missing friends"],
    suggestion: { kind: "social_call", details: "A short video call with your old flatmate.", status: "accepted" },
    outcome: { tried: true, felt: 3, said: "Had the video call; it was fine, felt about the same." },
  },
  11: {
    ratings: { mood: 3, energy: 3, sleepQuality: 3 },
    themes: ["new project starting", "late evenings"],
    quotes: ["The new project already has a deadline."],
    suggestion: { kind: "walk", details: "A walk after work before sitting down again.", status: "accepted" },
    outcome: { tried: true, felt: 4, said: "Walked after work twice; it helped to switch off." },
  },
  9: {
    ratings: { mood: 3, energy: 3, sleepQuality: 3 },
    themes: ["work deadlines", "photography"],
    suggestion: { kind: "daylight", details: DETAILS.morningLight, status: "accepted" },
    outcome: { tried: true, felt: 4, said: "Got out in the morning light once; it helped a bit." },
  },
  7: {
    ratings: { mood: 3, energy: 2, sleepQuality: 2 },
    themes: ["work deadlines", "evening phone habit", "short sleep"],
    quotes: ["I'm on my phone until late again."],
    voiceCues: [TIRED],
    sleepNote: "Went to bed late after scrolling.",
    suggestion: { kind: "breathing", details: "Phone out of the bedroom and five slow breaths before sleep.", status: "accepted" },
    outcome: { tried: false, felt: null, said: "Did not try it; the phone stayed by the bed." },
  },
  5: {
    ratings: { mood: 2, energy: 2, sleepQuality: 2 },
    themes: ["work deadlines", "short sleep", "missing friends"],
    quotes: ["I haven't seen anyone outside work in two weeks.", "Sleep is all over the place again."],
    voiceCues: [FLAT],
    suggestion: { kind: "social_call", details: "Send a message to a friend to plan a coffee.", status: "declined" },
  },
  3: {
    ratings: { mood: 3, energy: 2, sleepQuality: 2 },
    themes: ["evening phone habit", "tired at work"],
    quotes: ["I know the scrolling doesn't help, I just do it."],
    voiceCues: [QUIET],
    suggestion: { kind: "music", details: DETAILS.albumSide, status: "accepted" },
    outcome: { tried: false, felt: null, said: "Worked late and did not get to the music." },
  },
  1: {
    ratings: { mood: 2, energy: 2, sleepQuality: 1 },
    themes: ["short sleep", "evening phone habit", "missing the bike rides"],
    quotes: ["I haven't been on the bike in over a week."],
    voiceCues: [TIRED],
    sleepNote: "Woke early and could not get back to sleep.",
    // Accepted, with no Outcome yet: the next Check-in asks how it went.
    suggestion: { kind: "daylight", details: DETAILS.morningLight, status: "accepted" },
  },
};

/** Days with no Signals at all (phone and watch left off), and days the watch was charging. */
const NO_SIGNALS = new Set([33, 17]);
const WATCH_OFF = new Set([37, 25, 14, 12]);

/** @type {Profile} */
export const live = {
  key: "live",
  id: "live-demo", // replaced by the account's uid
  displayName: "Alex",
  synthetic: false,
  seededHistory: true,
  intakeHighlights:
    "Finished a course of TMS six weeks ago with a good response. Works full time as a designer in a " +
    "small studio; the work comes in bursts before deadlines. Moved to the city two years ago and misses " +
    "close friends from home. Earlier low periods began with short sleep, late evenings on the phone and " +
    "dropping plans. Cycles to work in good weather and takes photos on walks. Morning daylight and time " +
    "outdoors have helped before. Prefers short, practical suggestions.",
  visitScore: 9,
  tmsEndVisitScore: 7,
  usual: { sleep: 445, steps: 9200, hr: 68, rhr: 56, hrv: 52, home: 780, radius: 9, busy: 270, screen: 15 },
  // The last nine days drift, to about 60% of the declining Demo Patient's change by today.
  decline: (d) => (d <= 9 ? (0.6 * (10 - d)) / 10 : 0),
  // The Outcome score adds 0.3 x the day's steps against Baseline. On Check-in days up to the
  // drift, steps sit within a few hundred of the usual, so the score follows what the Patient said
  // and the ranking of what helps is the one the story tells, whatever the seed.
  overrides: (d) => (d >= 9 && d in LIVE_SCRIPT ? { steps: 9200 + ((d * 137) % 400) - 200 } : {}),
  // Last night's sleep in spreads from the Baseline: the deadline week, the catch-up night, then the
  // recent drift. Never as far as the red line (2.5 spreads, or under three hours).
  sleepTargets: { 31: -1.3, 30: -1.6, 29: -1.2, 28: 1.2, 8: -0.6, 7: -0.9, 6: -1.1, 5: -1.2, 4: -1.4, 3: -1.3, 2: -1.6, 1: -1.8, 0: -2 },
  signalsPresent: (d) => (NO_SIGNALS.has(d) ? "none" : WATCH_OFF.has(d) ? "some" : "all"),
  checksIn: (d) => d in LIVE_SCRIPT,
  ratings: (d) => ({ ...(LIVE_SCRIPT[d]?.ratings ?? { mood: null, energy: null, sleepQuality: null }) }),
  script: LIVE_SCRIPT,
  // The Clinician followed up on the deadline week's poor-sleep flag by phone and cleared it.
  followUps: [{ kind: "poor_sleep", at: { d: 27, hour: 14, minute: 30 } }],
  // Seen now: the generator caps this at the moment of seeding.
  lastSeen: { d: 0, hour: 23, minute: 59 },
};
