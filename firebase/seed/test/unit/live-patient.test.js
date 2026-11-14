// The live demo Patient: one real (not synthetic) Patient account with six weeks of invented history.
// Determinism, the profile's story, the markers that let --reset find the seeded history, and the
// data contract.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { CONSENT_PURPOSES, FLAG_KINDS, FLAG_LEVELS, SUGGESTION_KINDS } from "../../../hosting/js/lib/contract.js";
import { whatHelps, whatHelpsWindow } from "../../../hosting/js/lib/what-helps.js";
import { SIGNAL_KEYS, compareWithBaseline, composite, oriented } from "../../src/baseline.js";
import { addDays, dateInZone, zonedMillis } from "../../src/dates.js";
import { THRESHOLDS } from "../../src/flags.js";
import { outcomeScore } from "../../src/generate.js";
import {
  LIVE_DEFAULT_DISPLAY_NAME,
  SEED_ID_PREFIX,
  isSeededEntry,
  makeLivePatient,
  maskEmail,
  recordAfterSeeding,
  refuseRedFlags,
} from "../../src/live-patient.js";

/** @typedef {import("../../src/generate.js").DemoPatient} DemoPatient */

const TODAY = "2026-11-14";
const NOW = zonedMillis(TODAY, 9, 30);
const UID = "Xy7uid0000000000000000000001";
const CLINICIAN = "clinician@example.com";
const contract = JSON.parse(readFileSync(new URL("../../../functions/test/fixtures/contract.json", import.meta.url), "utf8"));
const COLLECTIONS = /** @type {const} */ (["daily", "consents", "checkIns", "summaries", "suggestions", "flags", "visits"]);

const live = makeLivePatient({ patientId: UID, clinicianEmail: CLINICIAN, today: TODAY, nowMillis: NOW });

/** @param {DemoPatient} p */
const entries = (p) => COLLECTIONS.flatMap((name) => p[name].map((e) => ({ name, ...e })));
/** @param {number[]} xs */
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** @param {DemoPatient} p */
const openFlags = (p) => p.flags.map((f) => f.data).filter((f) => f.clearedAtMillis === null);
/** The newest Suggestion, as the app's get_last_suggestion reads it. @param {DemoPatient} p */
const lastSuggestion = (p) => [...p.suggestions].sort((a, b) => b.data.suggestedAtMillis - a.data.suggestedAtMillis)[0].data;

describe("determinism", () => {
  test("the same inputs give byte-identical output", () => {
    const again = makeLivePatient({ patientId: UID, clinicianEmail: CLINICIAN, today: TODAY, nowMillis: NOW });
    assert.equal(JSON.stringify(again), JSON.stringify(live));
  });

  test("a different seed changes the values but not the ids or the story", () => {
    const other = makeLivePatient({ patientId: UID, clinicianEmail: CLINICIAN, today: TODAY, nowMillis: NOW, seed: 7 });
    assert.notEqual(JSON.stringify(other.daily), JSON.stringify(live.daily));
    for (const name of COLLECTIONS) {
      if (name !== "flags") assert.deepEqual(other[name].map((e) => e.id), live[name].map((e) => e.id), name);
    }
    // Flags sit on the morning their rule first holds, which the values decide.
    const kinds = (/** @type {DemoPatient} */ p) => p.flags.map((f) => `${f.data.kind}:${f.data.clearedAtMillis === null ? "open" : "cleared"}`).sort();
    assert.deepEqual(kinds(other), kinds(live));
  });

  test("dates follow --today", () => {
    const later = makeLivePatient({ patientId: UID, clinicianEmail: CLINICIAN, today: addDays(TODAY, 3) });
    assert.equal(later.daily.at(-1)?.id, addDays(TODAY, 3));
    assert.equal(later.patient.tmsEndDate, addDays(TODAY, 3 - 42));
  });
});

describe("the Patient record", () => {
  test("is the account's uid, not synthetic, honestly labelled as synthetic health data", () => {
    assert.equal(live.id, UID);
    assert.equal(live.patient.synthetic, false);
    assert.equal(live.patient.healthSource, "synthetic");
    assert.equal(live.patient.clinicianEmail, CLINICIAN);
    assert.equal(live.patient.sharingConsent, "granted");
    assert.equal(live.patient.sharingChangedAtMillis, live.consents.find((c) => c.id === "sharing")?.data.changedAtMillis);
    assert.equal(live.patient.quietHoursStart, 21);
    assert.equal(live.patient.quietHoursEnd, 9);
    assert.equal(live.patient.tmsEndDate, addDays(TODAY, -42));
  });

  test("has a neutral default display name, and takes another", () => {
    assert.equal(live.patient.displayName, LIVE_DEFAULT_DISPLAY_NAME);
    const named = makeLivePatient({ patientId: UID, clinicianEmail: CLINICIAN, today: TODAY, displayName: "Robin" });
    assert.equal(named.patient.displayName, "Robin");
  });

  test("was seen now and last checked in yesterday evening", () => {
    assert.equal(live.patient.lastSeenAtMillis, NOW);
    const last = /** @type {number} */ (live.patient.lastCheckInAtMillis);
    assert.equal(dateInZone(last), addDays(TODAY, -1));
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", hour: "2-digit", hourCycle: "h23" }).format(last));
    assert.ok(hour >= 17 && hour <= 22, `hour ${hour}`);
    assert.equal(last, Math.max(...live.checkIns.map((c) => /** @type {number} */ (c.data.endedAtMillis))));
  });

  test("has plain, fictional Intake highlights with no clinical claims", () => {
    const intake = live.patient.intakeHighlights;
    assert.ok(intake.length > 100 && intake.split(/\s+/).length <= 120, intake);
    assert.match(intake, /TMS/);
  });
});

describe("marked as seeded history", () => {
  test("every daily record is demoOverride, every other document id starts with the seeded prefix", () => {
    for (const { data } of live.daily) assert.equal(data.demoOverride, true);
    for (const name of /** @type {const} */ (["checkIns", "summaries", "suggestions", "flags", "visits"])) {
      for (const { id } of live[name]) assert.ok(id.startsWith(SEED_ID_PREFIX), `${name}/${id}`);
    }
  });

  test("isSeededEntry finds exactly the seeded documents, and not what the app writes", () => {
    for (const e of entries(live)) {
      if (e.name === "consents") continue;
      assert.equal(isSeededEntry(e.name, e.id, e.data), true, `${e.name}/${e.id}`);
    }
    assert.equal(isSeededEntry("daily", TODAY, { demoOverride: false }), false);
    assert.equal(isSeededEntry("daily", TODAY, {}), false);
    assert.equal(isSeededEntry("checkIns", "5f0c5bde-2c1a-4e4e-9a59-3f3c2f1f7c11", {}), false);
    assert.equal(isSeededEntry("flags", "silent-1763100000000", {}), false);
    assert.equal(isSeededEntry("flags", "crisis-1763100000000", {}), false);
    assert.equal(isSeededEntry("digests", "demo-2026-W46", {}), false, "digests are the Digest function's, never seeded");
    assert.equal(isSeededEntry("consents", "steps", {}), false, "Consents are rewritten, never deleted");
  });

  test("a Check-in and its Summary share an id; a Suggestion is keyed by its own day", () => {
    assert.deepEqual(live.summaries.map((s) => s.id), live.checkIns.map((c) => c.id));
    for (const s of live.suggestions) assert.equal(s.data.id, s.id);
    for (const c of live.checkIns) assert.equal(c.data.id, c.id);
  });
});

describe("Daily Signals", () => {
  test("42 consecutive records ending today, compared with Baseline by the shared rule", () => {
    assert.equal(live.daily.length, 42);
    live.daily.forEach((e, i) => assert.equal(e.id, addDays(TODAY, i - 41)));
    for (const { data } of live.daily) {
      assert.deepEqual(Object.keys(data.values), SIGNAL_KEYS);
      for (const key of SIGNAL_KEYS) {
        const history = live.daily.map((e) => ({ date: e.data.date, value: e.data.values[key] ?? null }));
        assert.equal(data.vsBaseline[key], compareWithBaseline(history, { date: data.date, value: data.values[key] ?? null }));
      }
      assert.equal(data.composite, composite(data.vsBaseline));
    }
  });

  test("has realistic missing days, stored as null and never zero", () => {
    const empty = live.daily.filter((e) => SIGNAL_KEYS.every((k) => e.data.values[k] === null));
    const partial = live.daily.filter((e) => SIGNAL_KEYS.some((k) => e.data.values[k] === null) && !empty.includes(e));
    assert.ok(empty.length >= 1 && empty.length <= 4, `${empty.length} empty days`);
    assert.ok(partial.length >= 2, `${partial.length} partial days`);
    for (const { data } of live.daily) {
      for (const key of SIGNAL_KEYS) {
        if (data.values[key] === null) assert.equal(data.vsBaseline[key], null);
      }
      // Zero is never a stand-in for missing: these Signals are never truly zero on a worn watch.
      for (const key of /** @type {const} */ (["sleepMinutes", "steps", "meanHeartRate", "restingHeartRate", "hrv", "timeAtHomeMinutes", "movementRadiusKm"])) {
        assert.notEqual(data.values[key], 0, `${data.date} ${key}`);
      }
    }
  });

  test("is stable for the first month, then drifts: less sleep and steps, more time at home and late-night screen", () => {
    const stable = live.daily.slice(5, 32).map((e) => e.data);
    const recent = live.daily.slice(35).map((e) => e.data); // the last 7 days, what get_health_summary reads
    const avg = (/** @type {typeof stable} */ days, /** @type {import("../../src/baseline.js").SignalKey} */ key) =>
      mean(days.map((d) => d.vsBaseline[key]).filter((v) => v !== null && v !== undefined).map(Number));
    assert.ok(Math.abs(mean(stable.map((d) => d.composite).filter((c) => c !== null).map(Number))) < 0.4, "stable month");
    // The phone's health summary says "lower" or "higher than usual" at a mean of 1 spread.
    assert.ok(avg(recent, "sleepMinutes") <= -1, `sleep ${avg(recent, "sleepMinutes")}`);
    assert.ok(avg(recent, "steps") <= -1, `steps ${avg(recent, "steps")}`);
    assert.ok(avg(recent, "timeAtHomeMinutes") >= 1, `home ${avg(recent, "timeAtHomeMinutes")}`);
    assert.ok(avg(recent, "lateNightScreenMinutes") >= 1, `screen ${avg(recent, "lateNightScreenMinutes")}`);
    // The drift lowers the oriented sleep and the composite on the last three days.
    for (const d of live.daily.slice(-3).map((e) => e.data)) {
      assert.ok(/** @type {number} */ (oriented("sleepMinutes", d.vsBaseline.sleepMinutes ?? null)) <= THRESHOLDS.poorSleepOriented, d.date);
      assert.ok(/** @type {number} */ (d.composite) <= THRESHOLDS.driftComposite, d.date);
    }
  });
});

describe("Check-ins and Summaries", () => {
  test("about 20 to 25 Check-ins, more often early on, each with a Summary", () => {
    assert.ok(live.checkIns.length >= 20 && live.checkIns.length <= 25, `${live.checkIns.length}`);
    const firstTwoWeeks = live.checkIns.filter((c) => c.data.startedAtMillis < zonedMillis(addDays(TODAY, -27), 0, 0));
    const lastTwoWeeks = live.checkIns.filter((c) => c.data.startedAtMillis >= zonedMillis(addDays(TODAY, -14), 0, 0));
    assert.ok(firstTwoWeeks.length > lastTwoWeeks.length);
    assert.deepEqual(live.summaries.map((s) => s.data.checkInId), live.checkIns.map((c) => c.id));
  });

  test("ratings dip recently", () => {
    const moods = live.checkIns.map((c) => c.data.mood).filter((m) => m !== null).map(Number);
    assert.ok(mean(moods.slice(-4)) < mean(moods.slice(0, -4)) - 0.5);
    const sleepQ = live.checkIns.map((c) => c.data.sleepQuality).filter((m) => m !== null).map(Number);
    assert.ok(mean(sleepQ.slice(-4)) < mean(sleepQ.slice(0, -4)));
    for (const { data } of [...live.checkIns, ...live.summaries]) {
      for (const r of [data.mood, data.energy, data.sleepQuality]) assert.ok(r === null || (Number.isInteger(r) && r >= 1 && r <= 5));
    }
  });

  test("Summaries read like Finish Check-in output and cover the Patient's themes", () => {
    for (const { data } of live.summaries) {
      const checkIn = live.checkIns.find((c) => c.id === data.checkInId)?.data;
      assert.equal(data.mood, checkIn?.mood);
      assert.deepEqual(data.voiceCues, checkIn?.voiceCues);
      assert.ok(data.themes.length >= 1 && data.themes.length <= 4 && data.themes.every((t) => t.length <= 60));
      assert.ok(data.quotes.length <= 3 && data.quotes.every((q) => q.length <= 200));
      assert.ok(data.sleepLine.length > 0 && data.sleepLine.length <= 200);
      assert.ok(data.createdAtMillis > /** @type {number} */ (checkIn?.endedAtMillis));
    }
    const themes = live.summaries.flatMap((s) => s.data.themes).join(" | ").toLowerCase();
    for (const word of ["deadline", "sleep", "friends", "photo", "cycling", "phone"]) assert.ok(themes.includes(word), word);
  });

  test("Voice cues are observations with intensities 1 to 5", () => {
    const cues = live.checkIns.flatMap((c) => c.data.voiceCues);
    assert.ok(cues.length >= 3);
    for (const cue of cues) {
      assert.deepEqual(Object.keys(cue).sort(), [...contract.documents.VoiceCue].sort());
      assert.ok(cue.intensity >= 1 && cue.intensity <= 5);
    }
  });

  test("never uses clinical words (ADR 0001)", () => {
    const text = JSON.stringify([live.patient.intakeHighlights, live.summaries, live.suggestions, live.flags]);
    assert.doesNotMatch(text, /treatment|therapy|therapist|diagnos|disorder|depress|medication/i);
  });
});

describe("Suggestions and Outcomes", () => {
  test("cover the kinds, accepted and declined, with Outcomes by the seed's Outcome rule", () => {
    const kinds = new Set(/** @type {string[]} */ (live.suggestions.map((s) => s.data.kind)));
    for (const kind of ["walk", "nature", "music", "social_call", "breathing", "daylight"]) assert.ok(kinds.has(kind), kind);
    assert.ok(live.suggestions.some((s) => s.data.status === "declined"));
    for (const { data } of live.suggestions) {
      assert.ok(SUGGESTION_KINDS.includes(data.kind));
      if (data.status === "declined") assert.equal(data.outcomeScore, null);
      if (data.outcomeScore !== null) {
        assert.equal(data.status, "accepted");
        assert.equal(data.outcomeScore, outcomeScore(/** @type {boolean} */ (data.tried), data.felt, data.objectiveChange));
      }
    }
  });

  test("the most recent Suggestion is accepted and has no Outcome yet, so the next Check-in asks how it went", () => {
    const last = lastSuggestion(live);
    assert.equal(last.status, "accepted");
    for (const key of /** @type {const} */ (["tried", "felt", "objectiveChange", "outcomeScore"])) assert.equal(last[key], null, key);
    // Every earlier accepted Suggestion was answered.
    for (const { data } of live.suggestions) {
      if (data.status === "accepted" && data.id !== last.id) assert.notEqual(data.tried, null, data.id);
    }
    // The latest Summary names it.
    assert.equal(live.summaries.at(-1)?.data.suggestion, last.details);
  });

  test("breathing is mostly not tried", () => {
    const breathing = live.suggestions.map((s) => s.data).filter((s) => s.kind === "breathing" && s.tried !== null);
    assert.ok(breathing.filter((s) => s.tried === false).length > breathing.length / 2);
  });

  // Daylight, walks and nature on top; music helps a little; calls are mixed; breathing last.
  const assertRanking = (/** @type {DemoPatient} */ p, /** @type {string} */ today, /** @type {string} */ label) => {
    for (const window of [whatHelpsWindow(today), { start: addDays(today, -60), end: today }]) {
      const { rows, waiting } = whatHelps(p.suggestions.map((s) => s.data), window);
      const order = rows.map((r) => r.kind);
      assert.deepEqual(order.slice(0, 3).sort(), ["daylight", "nature", "walk"], `${label}: ${order}`);
      const meanOf = (/** @type {string} */ kind) => /** @type {number} */ (rows.find((r) => r.kind === kind)?.mean);
      assert.ok(meanOf("music") > 0, `${label}: music ${meanOf("music")}`);
      assert.ok(meanOf("music") > meanOf("social_call"), `${label}: music vs calls`);
      assert.ok(meanOf("breathing") < 0, `${label}: breathing`);
      assert.equal(waiting, 1, `${label}: one Suggestion waits for its Outcome`);
    }
  };

  test("the Outcome scores give the intended ranking on the dashboard's 28-day window and overall", () => {
    assertRanking(live, TODAY, "default");
  });

  test("the ranking holds for other seeds and days", () => {
    for (const seed of [1, 2, 3, 42, 1234]) {
      for (const today of ["2026-03-29", "2026-10-25", "2027-01-01"]) {
        assertRanking(makeLivePatient({ patientId: UID, clinicianEmail: CLINICIAN, today, seed }), today, `seed ${seed}, ${today}`);
      }
    }
  });
});

describe("Attention flags", () => {
  /** @param {DemoPatient} p */
  const assertFlags = (p) => {
    const flags = p.flags.map((f) => f.data);
    assert.ok(flags.every((f) => f.level !== "red"), "no red flag: it would email the Clinician");
    assert.ok(flags.every((f) => f.sharedWithClinician === true));
    // An earlier poor-sleep flag, cleared by the Clinician after follow-up.
    const cleared = flags.filter((f) => f.clearedAtMillis !== null);
    assert.equal(cleared.length, 1);
    assert.equal(cleared[0].kind, "poor_sleep");
    assert.ok(/** @type {number} */ (cleared[0].clearedAtMillis) > cleared[0].raisedAtMillis);
    // A current open amber flag for poor sleep, raised in the last week.
    const open = openFlags(p);
    assert.ok(open.length >= 1 && open.every((f) => f.level === "amber"));
    const sleep = open.find((f) => f.kind === "poor_sleep");
    assert.ok(sleep, "an open poor_sleep flag");
    assert.ok(sleep.raisedAtMillis > /** @type {number} */ (cleared[0].clearedAtMillis));
    assert.equal(p.patient.flagLevel, "amber");
  };

  test("an earlier poor-sleep flag was cleared after follow-up; a current amber one is open; no red", () => {
    assertFlags(live);
    const sleep = openFlags(live).find((f) => f.kind === "poor_sleep");
    assert.ok(/** @type {number} */ (sleep?.raisedAtMillis) >= zonedMillis(addDays(TODAY, -7), 0, 0));
  });

  test("the record's level and reasons match the open flags", () => {
    const rank = { green: 0, amber: 1, red: 2 };
    const open = openFlags(live).sort((a, b) => rank[b.level] - rank[a.level] || b.raisedAtMillis - a.raisedAtMillis);
    assert.deepEqual(live.patient.flagReasons, open.map((f) => f.reason));
  });

  test("every flag's rule holds on the morning it was raised", () => {
    for (const { id, data } of live.flags) {
      const date = id.slice(-10);
      const i = live.daily.findIndex((e) => e.id === date);
      const days = live.daily.slice(0, i + 1).map((e) => e.data);
      if (data.kind === "poor_sleep") {
        const sleep = days.slice(-3).map((d) => oriented("sleepMinutes", d.vsBaseline.sleepMinutes ?? null));
        assert.ok(sleep.every((v) => v !== null && v <= THRESHOLDS.poorSleepOriented), id);
      }
      if (data.kind === "drift") assert.ok(days.slice(-3).every((d) => d.composite !== null && d.composite <= THRESHOLDS.driftComposite), id);
      assert.ok(["poor_sleep", "drift"].includes(data.kind), `unexpected ${data.kind}`);
    }
  });

  test("the flags hold for other seeds and days", () => {
    for (const seed of [1, 2, 3, 42, 1234]) {
      for (const today of ["2026-03-29", "2026-10-25", "2027-01-01"]) assertFlags(makeLivePatient({ patientId: UID, clinicianEmail: CLINICIAN, today, seed }));
    }
  });
});

describe("Visits and Consents", () => {
  test("a Visit 21 days ago with PHQ-9 9, and the TMS end Visit", () => {
    const byDate = Object.fromEntries(live.visits.map((v) => [v.data.date, v.data]));
    assert.deepEqual(byDate[addDays(TODAY, -21)], { date: addDays(TODAY, -21), questionnaire: "phq9", score: 9 });
    assert.equal(byDate[addDays(TODAY, -42)]?.questionnaire, "phq9");
    assert.equal(live.visits.length, 2);
  });

  test("every Signal Consent, sharing, ratings and Voice cues are granted", () => {
    assert.deepEqual(live.consents.map((c) => c.id).sort(), [...SIGNAL_KEYS, ...CONSENT_PURPOSES].sort());
    for (const { data } of live.consents) assert.equal(data.granted, true);
  });
});

describe("the data contract", () => {
  test("every document has exactly the contract's fields, with no undefined value", () => {
    const docs = contract.documents;
    const names = { daily: "DailyDoc", consents: "Consent", checkIns: "CheckIn", summaries: "Summary", suggestions: "Suggestion", flags: "Flag", visits: "Visit" };
    assert.deepEqual(Object.keys(live.patient).sort(), [...docs.PatientDoc].sort());
    for (const e of entries(live)) {
      assert.deepEqual(Object.keys(e.data).sort(), [...docs[names[e.name]]].sort(), `${e.name}/${e.id}`);
      for (const value of Object.values(e.data)) assert.notEqual(value, undefined);
    }
    for (const { data } of live.flags) assert.ok(FLAG_LEVELS.includes(data.level) && FLAG_KINDS.includes(data.kind));
  });

  test("stamps nothing later than now", () => {
    const stamps = [
      live.patient.lastSeenAtMillis,
      live.patient.lastCheckInAtMillis,
      ...live.checkIns.flatMap((c) => [c.data.startedAtMillis, c.data.endedAtMillis]),
      ...live.summaries.map((s) => s.data.createdAtMillis),
      ...live.suggestions.map((s) => s.data.suggestedAtMillis),
      ...live.flags.flatMap((f) => [f.data.raisedAtMillis, f.data.clearedAtMillis]),
      ...live.consents.map((c) => c.data.changedAtMillis),
    ];
    for (const stamp of stamps) assert.ok(stamp === null || (Number.isInteger(stamp) && stamp <= NOW), String(stamp));
  });
});

describe("recordAfterSeeding", () => {
  test("with nothing from the app, the record is the generated one", () => {
    assert.deepEqual(recordAfterSeeding(live, { flags: [], checkIns: [] }), live.patient);
  });

  test("keeps what the app wrote: its open flags count toward the level, a later Check-in stays the last", () => {
    const appFlag = { id: "crisis-1", level: /** @type {const} */ ("red"), kind: /** @type {const} */ ("crisis"), reason: "The Companion heard signs of a crisis in a Check-in.", raisedAtMillis: NOW - 1000, clearedAtMillis: null, sharedWithClinician: true };
    const hidden = { ...appFlag, id: "crisis-2", reason: "Hidden", sharedWithClinician: false };
    const record = recordAfterSeeding(live, { flags: [appFlag, hidden], checkIns: [{ endedAtMillis: NOW - 500 }] });
    assert.equal(record.flagLevel, "red");
    assert.deepEqual(record.flagReasons, [appFlag.reason, ...live.patient.flagReasons]);
    assert.equal(record.lastCheckInAtMillis, NOW - 500);
    // An older app Check-in does not move it back.
    assert.equal(recordAfterSeeding(live, { flags: [], checkIns: [{ endedAtMillis: 5 }] }).lastCheckInAtMillis, live.patient.lastCheckInAtMillis);
  });
});

describe("refuseRedFlags", () => {
  test("passes the default history and refuses one with a red flag, which would email the Clinician", () => {
    assert.doesNotThrow(() => refuseRedFlags(live));
    const red = { ...live, flags: [...live.flags, { id: "demo-sleep_collapse-x", data: { ...live.flags[0].data, level: /** @type {const} */ ("red") } }] };
    assert.throws(() => refuseRedFlags(red), /red flag/);
  });
});

describe("maskEmail", () => {
  test("shows neither the whole name nor the whole domain", () => {
    const masked = maskEmail("someone.private@example.com");
    assert.doesNotMatch(masked, /someone|private|example/);
    assert.match(masked, /^s.*@e.*\.com$/);
  });
});
