// The Demo Patient generator: determinism, the three profiles, and the data contract.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  CONSENT_PURPOSES,
  FLAG_KINDS,
  FLAG_LEVELS,
  QUESTIONNAIRE_KINDS,
  SUGGESTION_KINDS,
  SUGGESTION_STATUSES,
} from "../../../hosting/js/lib/contract.js";
import { SIGNAL_KEYS, compareWithBaseline, composite } from "../../src/baseline.js";
import { addDays, zonedMillis } from "../../src/dates.js";
import { THRESHOLDS } from "../../src/flags.js";
import { DEMO_CLINICIAN_EMAIL, generateDemoPatients, makePatient, outcomeScore } from "../../src/generate.js";

/** @typedef {import("../../src/generate.js").DemoPatient} DemoPatient */

const TODAY = "2026-11-14";
const NOW = zonedMillis(TODAY, 9, 30);
const contract = JSON.parse(
  readFileSync(new URL("../../../functions/test/fixtures/contract.json", import.meta.url), "utf8"),
);
const RANK = { green: 0, amber: 1, red: 2 };

const all = generateDemoPatients({ today: TODAY, nowMillis: NOW });
const byProfile = Object.fromEntries(all.map((p) => [p.profile, p]));
const { steady, declining, sparse } = /** @type {Record<string, DemoPatient>} */ (byProfile);

/** Every subcollection entry of a Patient, with its collection name. @param {DemoPatient} p */
function entries(p) {
  return /** @type {const} */ (["daily", "consents", "checkIns", "summaries", "suggestions", "flags", "visits"]).flatMap(
    (name) => p[name].map((e) => ({ name, ...e })),
  );
}

/** @param {DemoPatient} p */
const openFlags = (p) => p.flags.map((f) => f.data).filter((f) => f.clearedAtMillis === null);

describe("determinism", () => {
  test("the same inputs give byte-identical output", () => {
    const again = generateDemoPatients({ today: TODAY, nowMillis: NOW });
    assert.equal(JSON.stringify(again), JSON.stringify(all));
  });

  test("without nowMillis the output depends only on the date and seed", () => {
    const a = JSON.stringify(generateDemoPatients({ today: TODAY }));
    const b = JSON.stringify(generateDemoPatients({ today: TODAY }));
    assert.equal(a, b);
  });

  test("a different seed gives different values but the same shape", () => {
    const other = generateDemoPatients({ today: TODAY, nowMillis: NOW, seed: 7 });
    assert.notEqual(JSON.stringify(other), JSON.stringify(all));
    assert.deepEqual(other.map((p) => p.id), all.map((p) => p.id));
  });

  test("dates are relative to today: a later day shifts every date", () => {
    const later = makePatient("steady", { today: addDays(TODAY, 10) });
    assert.equal(later.daily.at(-1)?.id, addDays(TODAY, 10));
    assert.equal(later.patient.tmsEndDate, addDays(TODAY, 10 - 42));
  });
});

describe("every Demo Patient", () => {
  test("has the stable ids, the demo Clinician and granted sharing", () => {
    assert.deepEqual(all.map((p) => p.id), ["demo-steady", "demo-declining", "demo-sparse"]);
    for (const p of all) {
      assert.equal(p.patient.clinicianEmail, DEMO_CLINICIAN_EMAIL);
      assert.equal(p.patient.sharingConsent, "granted");
      assert.equal(p.consents.find((c) => c.id === "sharing")?.data.granted, true);
    }
  });

  test("is marked synthetic with a synthetic health source", () => {
    for (const p of all) {
      assert.equal(p.patient.synthetic, true);
      assert.equal(p.patient.healthSource, "synthetic");
    }
  });

  test("has an Intake that begins 'Synthetic demo data'", () => {
    for (const p of all) {
      assert.ok(p.patient.intakeHighlights.startsWith("Synthetic demo data"), p.id);
      assert.ok(p.patient.intakeHighlights.split(/\s+/).length <= 120, `${p.id}: Intake over 120 words`);
    }
  });

  test("has 42 consecutive daily records ending today", () => {
    for (const p of all) {
      assert.equal(p.daily.length, 42, p.id);
      p.daily.forEach((e, i) => {
        assert.equal(e.id, addDays(TODAY, i - 41));
        assert.equal(e.data.date, e.id);
        assert.equal(e.data.demoOverride, false);
      });
    }
  });

  test("has a TMS end date 42 days ago and one Visit 21 days ago with a Questionnaire score", () => {
    for (const p of all) {
      assert.equal(p.patient.tmsEndDate, addDays(TODAY, -42));
      assert.equal(p.visits.length, 1);
      const visit = p.visits[0].data;
      assert.equal(visit.date, addDays(TODAY, -21));
      assert.ok(visit.questionnaire !== null && QUESTIONNAIRE_KINDS.includes(visit.questionnaire));
      const max = visit.questionnaire === "phq9" ? 27 : 6;
      assert.ok(Number.isInteger(visit.score) && /** @type {number} */ (visit.score) >= 0 && /** @type {number} */ (visit.score) <= max);
    }
  });

  test("writes every Signal key, with missing values as null and never zero", () => {
    for (const p of all) {
      for (const { data } of p.daily) {
        assert.deepEqual(Object.keys(data.values), SIGNAL_KEYS);
        assert.deepEqual(Object.keys(data.vsBaseline), SIGNAL_KEYS);
        for (const key of SIGNAL_KEYS) {
          assert.notEqual(data.values[key], undefined);
          if (data.values[key] === null) assert.equal(data.vsBaseline[key], null, `${p.id} ${data.date} ${key}`);
        }
      }
    }
  });

  test("compares each day with Baseline by the shared rule", () => {
    for (const p of all) {
      for (const { data } of p.daily) {
        for (const key of SIGNAL_KEYS) {
          const history = p.daily.map((e) => ({ date: e.data.date, value: e.data.values[key] ?? null }));
          assert.equal(data.vsBaseline[key], compareWithBaseline(history, { date: data.date, value: data.values[key] ?? null }));
        }
        assert.equal(data.composite, composite(data.vsBaseline));
      }
      // Fewer than five valid prior days: the first five records have no comparison.
      for (const { data } of p.daily.slice(0, 5)) {
        assert.ok(Object.values(data.vsBaseline).every((v) => v === null), `${p.id} ${data.date}`);
        assert.equal(data.composite, null);
      }
    }
  });

  test("has a Summary for every Check-in, keyed by the Check-in id", () => {
    for (const p of all) {
      assert.deepEqual(p.summaries.map((s) => s.id), p.checkIns.map((c) => c.id));
      for (const s of p.summaries) {
        const checkIn = p.checkIns.find((c) => c.id === s.id)?.data;
        assert.equal(s.data.checkInId, s.id);
        assert.equal(s.data.mood, checkIn?.mood);
        assert.ok(s.data.quotes.length <= 3 && s.data.quotes.every((q) => q.length <= 200));
      }
    }
  });

  test("rates the day with integers 1 to 5 or null", () => {
    for (const p of all) {
      for (const { data } of [...p.checkIns, ...p.summaries]) {
        for (const rating of [data.mood, data.energy, data.sleepQuality]) {
          assert.ok(rating === null || (Number.isInteger(rating) && rating >= 1 && rating <= 5), `${p.id}: ${rating}`);
        }
      }
    }
  });

  test("has Suggestions with Outcome scores, and the latest one still open", () => {
    for (const p of all) {
      const scored = p.suggestions.filter((s) => s.data.outcomeScore !== null);
      assert.ok(scored.length >= 1, `${p.id} has no scored Suggestion`);
      for (const { data } of p.suggestions) {
        assert.ok(SUGGESTION_KINDS.includes(data.kind));
        assert.ok(SUGGESTION_STATUSES.includes(data.status));
        if (data.outcomeScore !== null) {
          assert.equal(data.status, "accepted");
          assert.notEqual(data.tried, null);
          assert.ok(data.outcomeScore >= -1 && data.outcomeScore <= 1);
          assert.equal(data.outcomeScore, outcomeScore(/** @type {boolean} */ (data.tried), data.felt, data.objectiveChange));
        }
        if (data.status === "declined") assert.equal(data.tried, null);
      }
      const latest = p.suggestions.at(-1)?.data;
      assert.equal(latest?.tried, null);
      assert.equal(latest?.outcomeScore, null);
    }
  });

  test("keeps the Patient's level and reasons in step with the open flags", () => {
    for (const p of all) {
      const open = openFlags(p).sort((a, b) => RANK[b.level] - RANK[a.level] || b.raisedAtMillis - a.raisedAtMillis);
      assert.equal(p.patient.flagLevel, open[0]?.level ?? "green");
      assert.deepEqual(p.patient.flagReasons, open.map((f) => f.reason));
      const kinds = open.map((f) => f.kind);
      assert.equal(new Set(kinds).size, kinds.length, `${p.id}: a kind raised twice while open`);
    }
  });

  test("never writes a reason that reads as a score", () => {
    for (const p of all) {
      for (const reason of [...p.patient.flagReasons, ...p.flags.map((f) => f.data.reason)]) {
        assert.doesNotMatch(reason, /\d+[.,]\d|%|score|risk/i, reason);
      }
    }
  });

  test("stamps nothing later than the moment of seeding", () => {
    for (const p of all) {
      const stamps = [
        p.patient.lastSeenAtMillis,
        p.patient.lastCheckInAtMillis,
        p.patient.sharingChangedAtMillis,
        ...p.checkIns.flatMap((c) => [c.data.startedAtMillis, c.data.endedAtMillis]),
        ...p.summaries.map((s) => s.data.createdAtMillis),
        ...p.suggestions.map((s) => s.data.suggestedAtMillis),
        ...p.flags.map((f) => f.data.raisedAtMillis),
        ...p.consents.map((c) => c.data.changedAtMillis),
      ];
      for (const stamp of stamps) assert.ok(stamp === null || (Number.isInteger(stamp) && stamp <= NOW), `${p.id}: ${stamp}`);
    }
    const early = generateDemoPatients({ today: TODAY, nowMillis: zonedMillis(TODAY, 3, 0) });
    for (const p of early) assert.ok(/** @type {number} */ (p.patient.lastSeenAtMillis) <= zonedMillis(TODAY, 3, 0));
  });

  test("uses the contract's field names and enumerations for every document", () => {
    const docs = contract.documents;
    for (const p of all) {
      assert.deepEqual(Object.keys(p.patient).sort(), [...docs.PatientDoc].sort());
      const names = { daily: "DailyDoc", consents: "Consent", checkIns: "CheckIn", summaries: "Summary", suggestions: "Suggestion", flags: "Flag", visits: "Visit" };
      for (const e of entries(p)) {
        assert.deepEqual(Object.keys(e.data).sort(), [...docs[names[e.name]]].sort(), `${p.id} ${e.name}/${e.id}`);
        for (const value of Object.values(e.data)) assert.notEqual(value, undefined);
      }
      for (const { data } of p.flags) {
        assert.ok(FLAG_LEVELS.includes(data.level) && FLAG_KINDS.includes(data.kind));
      }
      for (const { data } of [...p.checkIns, ...p.summaries]) {
        for (const cue of data.voiceCues) {
          assert.deepEqual(Object.keys(cue).sort(), [...docs.VoiceCue].sort());
          assert.ok(cue.intensity >= 1 && cue.intensity <= 5);
        }
      }
      assert.deepEqual(p.consents.map((c) => c.id).sort(), [...SIGNAL_KEYS, ...CONSENT_PURPOSES].sort());
    }
  });
});

describe("profiles", () => {
  test("steady is green, with no flags and Check-ins on most days", () => {
    assert.equal(steady.patient.flagLevel, "green");
    assert.deepEqual(steady.patient.flagReasons, []);
    assert.deepEqual(steady.flags, []);
    assert.ok(steady.checkIns.length >= 25, `only ${steady.checkIns.length} Check-ins`);
    for (const { data } of steady.checkIns) assert.ok(data.mood === null || data.mood >= 3);
  });

  test("declining ends red, with amber flags raised before the red one", () => {
    assert.equal(declining.patient.flagLevel, "red");
    const flags = declining.flags.map((f) => f.data);
    const reds = flags.filter((f) => f.level === "red");
    const ambers = flags.filter((f) => f.level === "amber");
    assert.equal(reds.length, 1);
    assert.equal(reds[0].kind, "sleep_collapse");
    assert.ok(reds[0].raisedAtMillis >= zonedMillis(addDays(TODAY, -1), 0, 0), "red within the last two days");
    assert.ok(ambers.length >= 2);
    assert.ok(ambers.some((f) => f.kind === "poor_sleep") && ambers.some((f) => f.kind === "low_mood"));
    for (const amber of ambers) assert.ok(amber.raisedAtMillis < reds[0].raisedAtMillis, `${amber.kind} after red`);
    assert.equal(declining.patient.flagReasons[0], reds[0].reason);
  });

  test("declining worsens over the last ten days", () => {
    const window = (/** @type {number} */ from, /** @type {number} */ to) => declining.daily.slice(from, to).map((e) => e.data);
    const mean = (/** @type {number[]} */ xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const before = window(20, 32);
    const last = window(32, 42);
    assert.ok(mean(last.map((d) => /** @type {number} */ (d.values.sleepMinutes))) < mean(before.map((d) => /** @type {number} */ (d.values.sleepMinutes))) - 60);
    assert.ok(mean(last.map((d) => /** @type {number} */ (d.values.steps))) < mean(before.map((d) => /** @type {number} */ (d.values.steps))) * 0.8);
    assert.ok(/** @type {number} */ (last.at(-1)?.composite) <= -1);
    const moods = declining.checkIns.map((c) => c.data.mood);
    assert.ok(moods.slice(-3).every((m) => m !== null && m <= 2));
  });

  test("sparse has at most seven Check-ins and days of missing Signals stored as null", () => {
    assert.ok(sparse.checkIns.length <= 7 && sparse.checkIns.length >= 3, `${sparse.checkIns.length} Check-ins`);
    const emptyDays = sparse.daily.filter((e) => SIGNAL_KEYS.every((k) => e.data.values[k] === null));
    assert.ok(emptyDays.length >= 5, `${emptyDays.length} empty days`);
    for (const { data } of emptyDays) assert.equal(data.composite, null);
    assert.ok(["green", "amber"].includes(sparse.patient.flagLevel));
  });

  test("the list shows all three levels, so the sort is visible", () => {
    assert.deepEqual(all.map((p) => p.patient.flagLevel).sort(), ["amber", "green", "red"]);
  });
});

describe("seeded flags match the history", () => {
  // Each flag sits on the first morning its rule holds; nothing red is due before the red flag.
  for (const p of all) {
    test(`${p.profile}: every flag's rule holds on the morning it was raised`, () => {
      for (const { id, data } of p.flags) {
        const date = id.slice(-10);
        const i = p.daily.findIndex((e) => e.id === date);
        const days = p.daily.slice(0, i + 1).map((e) => e.data);
        const sleep = days.map((d) => d.vsBaseline.sleepMinutes);
        if (data.kind === "sleep_collapse") {
          const today = days.at(-1);
          assert.ok(
            (today?.values.sleepMinutes ?? Infinity) < THRESHOLDS.sleepCollapseMinutes ||
              (sleep.at(-1) ?? 0) <= THRESHOLDS.sleepCollapseOriented,
          );
        }
        if (data.kind === "poor_sleep") assert.ok(sleep.slice(-3).every((v) => typeof v === "number" && v <= THRESHOLDS.poorSleepOriented));
        if (data.kind === "drift") assert.ok(days.slice(-3).every((d) => d.composite !== null && d.composite <= THRESHOLDS.driftComposite));
        if (data.kind === "low_mood") {
          const moods = p.checkIns.filter((c) => /** @type {number} */ (c.data.endedAtMillis) < data.raisedAtMillis).map((c) => c.data.mood);
          assert.ok(moods.length >= 3 && moods.slice(-3).every((m) => m !== null && m <= THRESHOLDS.lowMoodAtMost));
        }
      }
    });
  }

  test("the profiles hold for other seeds and days, not just the default", () => {
    for (const seed of [1, 2, 3, 42, 1234]) {
      for (const today of ["2026-03-29", "2026-10-25", "2027-01-01"]) {
        const [s, d, r] = generateDemoPatients({ today, seed });
        assert.equal(s.patient.flagLevel, "green", `steady, seed ${seed}, ${today}`);
        assert.equal(d.patient.flagLevel, "red", `declining, seed ${seed}, ${today}`);
        const red = d.flags.find((f) => f.data.level === "red")?.data;
        assert.ok(d.flags.filter((f) => f.data.level === "amber").every((f) => f.data.raisedAtMillis < /** @type {number} */ (red?.raisedAtMillis)));
        assert.ok(r.checkIns.length <= 7);
      }
    }
  });
});
