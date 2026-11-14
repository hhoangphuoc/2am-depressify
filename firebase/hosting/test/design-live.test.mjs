// The live helpers (js/lib/design-live.js) with an in-memory stand-in for the Firestore functions:
// which queries they run (the sharing filters the rules require), what they emit, and how they
// react to withdrawal, errors and new red flags. The same helpers run against the emulators under
// the security rules in firebase/seed/test/emulator/design-live.test.js.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { generateDemoPatients } from "../../seed/src/generate.js";
import { zonedMillis } from "../../seed/src/dates.js";
import {
  ROSTER_DAILY_DAYS,
  SECTION_COLLECTIONS,
  clearAttention,
  extractIntake,
  generateDigestNow,
  recordVisit,
  rosterStatusFromError,
  saveIntake,
  setTmsEndDate,
  subscribePatient,
  subscribeRoster,
  subscribeSignals,
} from "../js/lib/design-live.js";
import { rosterView } from "../js/lib/design-model.js";

const TZ = "Europe/Helsinki";
const TODAY = "2026-11-13";
const NOW = zonedMillis(TODAY, 14, 20, TZ);
const clock = () => ({ nowMillis: NOW, timeZone: TZ });
const CLINICIAN = "clinician@example.com";
const demo = generateDemoPatients({ today: TODAY, nowMillis: NOW });
const byKey = Object.fromEntries(demo.map((p) => [p.profile, p]));
const entries = (list) => list.map((e) => ({ id: e.id, data: e.data }));

/** A stand-in for the Firestore functions: records listeners and lets the test push snapshots. */
function fakeFirestore() {
  /** @type {{ target: any, next: Function, error: Function, active: boolean }[]} */
  const listeners = [];
  const writes = [];
  const fs = {
    collection: (_db, ...path) => ({ kind: "collection", path: path.join("/") }),
    doc: (_db, ...path) => ({ kind: "doc", path: path.join("/") }),
    where: (field, op, value) => ({ type: "where", field, op, value }),
    orderBy: (field, direction) => ({ type: "orderBy", field, direction }),
    limit: (n) => ({ type: "limit", n }),
    query: (ref, ...constraints) => ({ kind: "query", path: ref.path, constraints }),
    onSnapshot(target, options, next, error) {
      assert.deepEqual(options, { includeMetadataChanges: true });
      const listener = { target, next, error, active: true };
      listeners.push(listener);
      return () => {
        listener.active = false;
      };
    },
    async addDoc(ref, data) {
      if (fs.failWith) throw Object.assign(new Error("x"), { code: fs.failWith });
      writes.push({ op: "add", path: ref.path, data });
      return { id: "new-visit" };
    },
    async updateDoc(ref, data) {
      if (fs.failWith) throw Object.assign(new Error("x"), { code: fs.failWith });
      writes.push({ op: "update", path: ref.path, data });
    },
    failWith: null,
  };
  const active = (path) => listeners.filter((l) => l.active && l.target.path === path);
  return {
    fs,
    listeners,
    writes,
    active,
    /** Pushes a collection snapshot to every active listener on `path`. */
    push(path, docs, { fromCache = false } = {}) {
      const found = active(path);
      assert.ok(found.length, `nobody listens to ${path}`);
      for (const l of found) {
        l.next({ metadata: { fromCache }, docs: docs.map(({ id, data }) => ({ id, data: () => structuredClone(data) })) });
      }
    },
    pushDoc(path, data, { fromCache = false } = {}) {
      for (const l of active(path)) l.next({ metadata: { fromCache }, exists: () => data !== undefined, data: () => (data === undefined ? undefined : structuredClone(data)) });
    },
    fail(path, code) {
      for (const l of active(path)) l.error(Object.assign(new Error(code), { code }));
    },
  };
}

const where = (target) => target.constraints.filter((c) => c.type === "where").map((c) => [c.field, c.op, c.value]);

describe("subscribeRoster", () => {
  function start(options = {}) {
    const db = fakeFirestore();
    const states = [];
    const stop = subscribeRoster(db.fs, {}, { clinicianEmail: CLINICIAN, clock, ...options }, (s) => states.push(s));
    const patients = () => db.push("patients", demo.map((p) => ({ id: p.id, data: p.patient })));
    return { db, states, stop, patients };
  }

  test("starts loading, and queries only this Clinician's sharing Patients", () => {
    const { db, states } = start();
    assert.equal(states[0].status, "loading");
    assert.deepEqual(where(db.listeners[0].target), [
      ["clinicianEmail", "==", CLINICIAN],
      ["sharingConsent", "==", "granted"],
    ]);
  });

  test("reads each Patient's flags, latest daily records and latest Check-in through the sharing stamp", () => {
    const { db, patients } = start();
    patients();
    for (const p of demo) {
      for (const name of ["flags", "daily", "checkIns"]) {
        const [listener] = db.active(`patients/${p.id}/${name}`);
        assert.ok(listener, `${p.id} ${name}`);
        assert.deepEqual(where(listener.target), [["sharedWithClinician", "==", true]]);
      }
      const daily = db.active(`patients/${p.id}/daily`)[0].target.constraints;
      assert.deepEqual(daily.slice(1), [{ type: "orderBy", field: "date", direction: "desc" }, { type: "limit", n: ROSTER_DAILY_DAYS }]);
    }
  });

  test("emits design patients in the design's order, with sparkline days and levels from the flags", () => {
    const { db, states, patients } = start();
    patients();
    for (const p of demo) {
      db.push(`patients/${p.id}/flags`, entries(p.flags));
      db.push(`patients/${p.id}/daily`, entries(p.daily).reverse().slice(0, ROSTER_DAILY_DAYS));
    }
    const last = states.at(-1);
    assert.equal(last.status, "ok");
    assert.deepEqual(last.patients.map((p) => [p.id, p.level]), [
      ["demo-declining", "red"],
      ["demo-sparse", "amber"],
      ["demo-steady", "green"],
    ]);
    assert.equal(last.patients[0].daily.length, ROSTER_DAILY_DAYS);
    assert.ok(Number.isFinite(last.patients[0].daily.at(-1).steps));
    assert.deepEqual(last.newRed, [], "the first load is never news");
    assert.equal(rosterView(last).banner.items[0].patientId, "demo-declining");
  });

  test("a red flag that arrives later is reported once, for the sound and the announcement", () => {
    const { db, states, patients } = start();
    patients();
    db.push("patients/demo-steady/flags", []);
    const red = { id: "inactive-live", data: { level: "red", kind: "inactive", reason: "No steps for a day.", raisedAtMillis: NOW, clearedAtMillis: null, sharedWithClinician: true } };
    db.push("patients/demo-steady/flags", [red]);
    assert.deepEqual(states.at(-1).newRed, [{ patientId: "demo-steady", displayName: "Aino (demo)", reason: "No steps for a day." }]);
    db.push("patients/demo-steady/daily", []);
    assert.deepEqual(states.at(-1).newRed, []);
  });

  test("reports the SDK's saved copy as fromCache (offline / stale)", () => {
    const { db, states } = start();
    db.push("patients", [{ id: byKey.steady.id, data: byKey.steady.patient }], { fromCache: true });
    assert.equal(states.at(-1).fromCache, true);
    db.push("patients", [{ id: byKey.steady.id, data: byKey.steady.patient }]);
    assert.equal(states.at(-1).fromCache, false);
  });

  test("a refused list is denied; an ended sign-in is expired", () => {
    for (const [code, status] of [["permission-denied", "denied"], ["unauthenticated", "expired"], ["unavailable", "error"]]) {
      const { db, states } = start();
      db.fail("patients", code);
      assert.equal(states.at(-1).status, status);
      assert.deepEqual(states.at(-1).patients, []);
    }
    assert.equal(rosterStatusFromError({ code: "firestore/permission-denied" }), "denied");
  });

  test("a Patient who withdraws leaves the list; with keepWithdrawn an anonymous row stays for this session", () => {
    for (const keepWithdrawn of [false, true]) {
      const { db, states, patients } = start({ keepWithdrawn });
      patients();
      db.push("patients", [byKey.steady, byKey.sparse].map((p) => ({ id: p.id, data: p.patient })));
      assert.equal(db.active("patients/demo-declining/flags").length, 0, "the withdrawn Patient's listeners stop");
      const ids = states.at(-1).patients.map((p) => [p.id, p.level, p.name]);
      if (!keepWithdrawn) assert.deepEqual(ids.map(([id]) => id), ["demo-sparse", "demo-steady"]);
      else assert.deepEqual(ids.at(-1), ["demo-declining", "hidden", "Patient sharing withdrawn"]);
    }
  });

  test("stop() ends every listener", () => {
    const { db, stop, patients } = start();
    patients();
    stop();
    assert.equal(db.listeners.filter((l) => l.active).length, 0);
  });
});

describe("subscribePatient", () => {
  function start(sections = "all") {
    const db = fakeFirestore();
    const states = [];
    const stop = subscribePatient(db.fs, {}, "demo-declining", { clock, sections }, (s) => states.push(s));
    return { db, states, stop };
  }

  test("loading, then the design's patient object once the record and collections answer", () => {
    const { db, states } = start();
    assert.equal(states[0].status, "loading");
    db.pushDoc("patients/demo-declining", byKey.declining.patient);
    for (const name of SECTION_COLLECTIONS.all) {
      const [listener] = db.active(`patients/demo-declining/${name}`);
      assert.ok(listener, name);
      const stamped = !["visits", "consents"].includes(name);
      assert.deepEqual(where(listener.target), stamped ? [["sharedWithClinician", "==", true]] : [], name);
    }
    assert.deepEqual(db.active("patients/demo-declining/digests")[0].target.constraints.slice(1), [
      { type: "orderBy", field: "isoWeek", direction: "desc" },
      { type: "limit", n: 1 },
    ]);
    const p = byKey.declining;
    db.push("patients/demo-declining/flags", entries(p.flags));
    db.push("patients/demo-declining/daily", entries(p.daily));
    db.push("patients/demo-declining/summaries", entries(p.summaries));
    db.push("patients/demo-declining/checkIns", entries(p.checkIns));
    db.push("patients/demo-declining/visits", entries(p.visits));
    const last = states.at(-1);
    assert.equal(last.status, "ok");
    assert.equal(last.patient.level, "red");
    assert.equal(last.patient.daily.length, 43);
    assert.equal(last.patient.summaries.length, p.summaries.length);
    assert.equal(last.loaded.flags, true);
    assert.equal(last.loaded.digests, false);
    assert.equal(last.raw.flags.length, p.flags.length);
  });

  test("a section listens only to what it needs", () => {
    const db = fakeFirestore();
    subscribeSignals(db.fs, {}, "demo-declining", { clock }, () => {});
    db.pushDoc("patients/demo-declining", byKey.declining.patient);
    const paths = db.listeners.filter((l) => l.active).map((l) => l.target.path).sort();
    assert.deepEqual(paths, ["patients/demo-declining", ...SECTION_COLLECTIONS.signals.map((c) => `patients/demo-declining/${c}`)].sort());
    assert.throws(() => subscribePatient(db.fs, {}, "x", { sections: "nope" }, () => {}), /Unknown section/);
  });

  test("withdrawal stops the collection listeners and shows only the placeholder; sharing again restarts them", () => {
    const { db, states } = start();
    db.pushDoc("patients/demo-declining", byKey.declining.patient);
    db.push("patients/demo-declining/flags", entries(byKey.declining.flags));
    // A Demo Patient stays readable through the demo shortcut, so the record says it.
    db.pushDoc("patients/demo-declining", { ...byKey.declining.patient, sharingConsent: "declined" });
    let last = states.at(-1);
    assert.equal(last.status, "withdrawn");
    assert.equal(last.patient.level, "hidden");
    assert.deepEqual(last.patient.activeFlags, []);
    assert.equal(last.raw, null);
    assert.equal(db.listeners.filter((l) => l.active).length, 1, "only the record's listener is left");

    db.pushDoc("patients/demo-declining", byKey.declining.patient);
    assert.equal(states.at(-1).status, "ok");
    assert.equal(db.active("patients/demo-declining/flags").length, 1);
    assert.equal(states.at(-1).loaded.flags, false, "nothing from before the withdrawal is kept");
  });

  test("permission-denied on the record is the withdrawn state; any other error is an error", () => {
    const a = start();
    a.db.fail("patients/demo-declining", "permission-denied");
    assert.equal(a.states.at(-1).status, "withdrawn");
    const b = start();
    b.db.fail("patients/demo-declining", "unavailable");
    assert.equal(b.states.at(-1).status, "error");
    assert.equal(b.states.at(-1).patient, null);
  });
});

describe("writes and calls", () => {
  const context = { today: TODAY, tms: "2026-10-02", visits: [{ id: "v", date: "2026-10-23" }] };

  test("recordVisit checks the form, then adds the Visit", async () => {
    const db = fakeFirestore();
    const bad = await recordVisit(db.fs, {}, "p1", { date: TODAY, type: "PHQ-9", score: "28" }, context);
    assert.equal(bad.ok, false);
    assert.equal(bad.invalid, true);
    assert.equal(db.writes.length, 0);
    const good = await recordVisit(db.fs, {}, "p1", { date: TODAY, type: "PHQ-9", score: "12" }, context);
    assert.deepEqual(good, { ok: true, id: "new-visit", visit: { date: TODAY, questionnaire: "phq9", score: 12 } });
    assert.deepEqual(db.writes, [{ op: "add", path: "patients/p1/visits", data: { date: TODAY, questionnaire: "phq9", score: 12 } }]);
  });

  test("a refused write keeps the form and says why, without the raw error", async () => {
    const db = fakeFirestore();
    db.fs.failWith = "permission-denied";
    const result = await recordVisit(db.fs, {}, "p1", { date: TODAY, type: "none" }, context);
    assert.equal(result.ok, false);
    assert.match(result.message, /stopped sharing/);
    db.fs.failWith = "unavailable";
    assert.match((await setTmsEndDate(db.fs, {}, "p1", "2026-10-01", context)).message, /Try again/);
  });

  test("setTmsEndDate checks the date and updates only tmsEndDate", async () => {
    const db = fakeFirestore();
    assert.equal((await setTmsEndDate(db.fs, {}, "p1", "2026-10-30", context)).ok, false, "after the first Visit");
    assert.deepEqual(await setTmsEndDate(db.fs, {}, "p1", "2026-10-01", context), { ok: true, date: "2026-10-01" });
    assert.deepEqual(db.writes, [{ op: "update", path: "patients/p1", data: { tmsEndDate: "2026-10-01" } }]);
  });

  test("clearAttention with nothing open writes nothing", async () => {
    const result = await clearAttention(fakeFirestore().fs, {}, { patientId: "p1", raw: { patient: {}, flags: [] }, nowMillis: NOW });
    assert.equal(result.ok, false);
  });

  test("Generate now, extract and save map failures to vetted copy", async () => {
    const failing = (code) => async () => {
      throw Object.assign(new Error("raw text with data"), { code: `functions/${code}` });
    };
    assert.deepEqual(await generateDigestNow({ generateDigest: async () => ({ digest: { text: "x" } }) }, "p1"), { ok: true, digest: { text: "x" } });
    const failed = await generateDigestNow({ generateDigest: failing("unavailable") }, "p1");
    assert.equal(failed.ok, false);
    assert.doesNotMatch(failed.message, /raw text/);

    assert.equal((await extractIntake({ extract: failing("x") }, "p1", "   ")).invalid, true);
    const extracted = await extractIntake({ extract: async () => ({ highlights: "- Walks\n- Music", trimmed: false }) }, "p1", "A report.");
    assert.deepEqual(extracted.highlights, ["Walks", "Music"]);
    assert.match((await extractIntake({ extract: failing("permission-denied") }, "p1", "A report.")).message, /Clinician/);

    let saved = null;
    const result = await saveIntake({ save: async (_id, text) => ((saved = text), { intakeHighlights: text }) }, "p1", ["Walks", "Music"]);
    assert.equal(saved, "- Walks\n- Music");
    assert.deepEqual(result.highlights, ["Walks", "Music"]);
    assert.equal((await saveIntake({ save: failing("x") }, "p1", [])).invalid, true);
  });
});
