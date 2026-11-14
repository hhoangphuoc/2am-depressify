// The dashboard design's live data helpers (hosting/js/lib/design-live.js) against the emulators,
// as the Clinician under the security rules, on the seeded Demo Patients: the roster and one
// Patient come back as design-model objects, the Digest lists its sources, withdrawal hides the
// Patient, and the design's writes (a Visit, the TMS end date, clearing every open flag) go through.
// Run inside the emulators:
//   cd firebase && firebase emulators:exec --only auth,firestore --project demo-twoam "npm --prefix seed run test:emulator"
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as firestore from "firebase/firestore";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { DESIGN_LEVELS, rosterView } from "../../../hosting/js/lib/design-model.js";
import { clearAttention, recordVisit, setTmsEndDate, subscribeDigest, subscribePatient, subscribeRoster } from "../../../hosting/js/lib/design-live.js";
import { DEMO_TIME_ZONE, dateInZone } from "../../src/dates.js";

const PROJECT_ID = process.env.GCLOUD_PROJECT || "demo-twoam";
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
const CLINICIAN = "clinician@example.com";
const seedDir = fileURLToPath(new URL("../../", import.meta.url));
/** The npm SDK's functions, as a React port would pass them. */
const FS = /** @type {any} */ (firestore);

if (!EMULATOR) throw new Error("FIRESTORE_EMULATOR_HOST is not set; run this inside firebase emulators:exec");
const [host, port] = EMULATOR.split(":");

const app = initializeApp({ projectId: PROJECT_ID }, "design-live-emulator-test");
const admin = getFirestore(app);
/** @type {import("@firebase/rules-unit-testing").RulesTestEnvironment} */
let rules;

/** @param {string} email */
const firestoreAs = (email) => /** @type {any} */ (rules.authenticatedContext(`uid-${email}`, { email }).firestore());
const clock = () => ({ nowMillis: Date.now(), timeZone: DEMO_TIME_ZONE });

/**
 * Subscribes and resolves with the first state that passes `ready`, then stops listening.
 * @template S
 * @param {(onChange: (state: S) => void) => () => void} subscribe
 * @param {(state: S) => boolean} ready
 * @returns {Promise<S>}
 */
function firstState(subscribe, ready, timeoutMillis = 8_000) {
  return new Promise((resolve, reject) => {
    /** @type {(() => void) | null} */
    let stop = null;
    let done = false;
    /** @type {S | undefined} */
    let last;
    const timer = setTimeout(() => {
      done = true;
      stop?.();
      reject(new Error(`no ready state within ${timeoutMillis} ms; last: ${JSON.stringify(last)?.slice(0, 400)}`));
    }, timeoutMillis);
    stop = subscribe((state) => {
      last = state;
      if (done || !ready(state)) return;
      done = true;
      clearTimeout(timer);
      queueMicrotask(() => stop?.());
      resolve(state);
    });
    if (done) stop();
  });
}

const allLoaded = (/** @type {any} */ s) => s.status === "ok" && Object.values(s.loaded).every(Boolean);

before(async () => {
  await fetch(`http://${EMULATOR}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  execFileSync(process.execPath, ["seed.js"], { cwd: seedDir, env: process.env, encoding: "utf8" });
  rules = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host, port: Number(port), rules: readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8") },
  });
});

after(async () => {
  await rules?.cleanup();
  await deleteApp(app);
});

test("the roster, as the Clinician under the rules, is the design's patient objects in the design's order", async () => {
  const db = firestoreAs(CLINICIAN);
  const roster = await firstState(
    (onChange) => subscribeRoster(FS, db, { clinicianEmail: CLINICIAN, clock }, onChange),
    (s) => s.status === "ok" && s.patients.length === 3 && s.patients.every((/** @type {any} */ p) => p.flagsLoaded && p.daily.some((/** @type {any} */ r) => r.steps !== null)),
  );
  assert.deepEqual(roster.patients.map((/** @type {any} */ p) => [p.id, p.level]), [
    ["demo-declining", "red"],
    ["demo-sparse", "amber"],
    ["demo-steady", "green"],
  ]);
  const declining = roster.patients[0];
  assert.equal(declining.levelWord, DESIGN_LEVELS.red);
  assert.equal(declining.daily.length, 28, "28 days for the sleep sparkline and its Baseline");
  assert.equal(declining.daily.at(-1).date, dateInZone(Date.now(), DEMO_TIME_ZONE));
  assert.ok(declining.activeFlags.length >= 2 && declining.activeFlags[0].level === "red");
  assert.equal(declining.alertsEnabled, false, "Demo Patients never email");
  const view = rosterView(roster, { search: "sara", filter: "amber" });
  assert.deepEqual(view.patients.map((p) => p.id), ["demo-sparse"]);
  assert.equal(view.banner?.items[0].patientId, "demo-declining", "filters never hide the red banner");
  assert.deepEqual(view.counts, { all: 3, red: 1, amber: 1, unknown: 0, green: 1, hidden: 0 });
});

test("signed out, the roster is denied and shows nothing", async () => {
  const db = /** @type {any} */ (rules.unauthenticatedContext().firestore());
  const roster = await firstState((onChange) => subscribeRoster(FS, db, { clinicianEmail: CLINICIAN, clock }, onChange), (s) => s.status !== "loading");
  assert.equal(roster.status, "denied");
  assert.deepEqual(roster.patients, []);
});

test("one Patient, every section: the design's patient object, with the off period hidden", async () => {
  const db = firestoreAs(CLINICIAN);
  const state = await firstState((onChange) => subscribePatient(FS, db, "demo-steady", { clock }, onChange), allLoaded);
  const p = state.patient;
  assert.ok(p);
  assert.equal(p.name, "Aino (demo)");
  assert.equal(p.level, "green");
  assert.equal(p.daily.length, 43, "from the TMS end date to today");
  const seededShared = (await admin.collection("patients/demo-steady/summaries").where("sharedWithClinician", "==", true).get()).size;
  assert.equal(p.summaries.length, seededShared, "only Summaries saved while sharing");
  const unshared = (await admin.collection("patients/demo-steady/daily").where("sharedWithClinician", "==", false).get()).docs.map((d) => d.id);
  assert.equal(unshared.length, 3);
  for (const date of unshared) assert.equal(p.daily.find((/** @type {any} */ r) => r.date === date)?.sleep, null, `${date} is a gap for the Clinician`);
  for (const s of p.summaries) assert.equal(p.daily.find((/** @type {any} */ r) => r.date === s.date)?.mood, s.mood);
  assert.equal(p.visits[0].type, "PHQ-9");
  assert.ok(p.intake && p.intake.highlights.length > 1);
  assert.equal(p.timeline.weekSinceTms, 6);
  assert.equal(p.signals.filter((/** @type {any} */ s) => !s.extra).length, 8);
  assert.ok(p.signals.every((/** @type {any} */ s) => s.sourceLabel === "Synthetic demo data"));
  assert.ok(p.whatHelps.rows.length > 0);
});

test("the Digest lists the Summaries it drew on", async () => {
  const shared = (await admin.collection("patients/demo-declining/summaries").where("sharedWithClinician", "==", true).get()).docs
    .map((d) => d.data())
    .sort((a, b) => b.createdAtMillis - a.createdAtMillis)
    .slice(0, 3)
    .reverse();
  const ids = shared.map((s) => s.checkInId);
  const today = dateInZone(Date.now(), DEMO_TIME_ZONE);
  // As writeDigestFor writes it (functions/test/emulator/digest.test.ts runs the function itself).
  await admin.doc("patients/demo-declining/digests/2999-W01").set({
    isoWeek: "2999-W01", weekStart: today, weekEnd: today, summaryCount: ids.length, sourceCheckInIds: ids,
    text: "A short, invented Digest.", generatedAtMillis: Date.now(), sharedWithClinician: true,
  });
  const db = firestoreAs(CLINICIAN);
  const state = await firstState((onChange) => subscribeDigest(FS, db, "demo-declining", { clock }, onChange), allLoaded);
  const digest = state.patient?.digest;
  assert.ok(digest);
  assert.deepEqual(digest.ids, ids);
  assert.deepEqual(digest.sources.map((/** @type {any} */ s) => s.id), ids);
  assert.equal(digest.missingSources, 0);
  await admin.doc("patients/demo-declining/digests/2999-W01").delete();
});

test("recording a Visit and the TMS end date as the Clinician; the flag is unchanged", async () => {
  const db = firestoreAs(CLINICIAN);
  const before = await firstState((onChange) => subscribePatient(FS, db, "demo-sparse", { clock, sections: "intakeVisits" }, onChange), allLoaded);
  const today = dateInZone(Date.now(), DEMO_TIME_ZONE);
  const context = { today, tms: before.patient?.tms, visits: before.patient?.visits };
  const saved = await recordVisit(FS, db, "demo-sparse", { date: today, type: "PHQ-2", score: "3" }, context);
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const visit = (await admin.doc(`patients/demo-sparse/visits/${saved.id}`).get()).data();
  assert.deepEqual(visit, { date: today, questionnaire: "phq2", score: 3 });
  assert.equal((await admin.doc("patients/demo-sparse").get()).data()?.flagLevel, "amber");

  const tms = await setTmsEndDate(FS, db, "demo-sparse", /** @type {string} */ (before.patient?.tms), context);
  assert.equal(tms.ok, true);
  // Another signed-in account that is not this Patient's Clinician cannot write a Visit to a live Patient.
  await admin.doc("patients/demo-sparse").update({ synthetic: false });
  const refused = await recordVisit(FS, firestoreAs("someone@example.com"), "demo-sparse", { date: today, type: "none" }, context);
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "permission-denied");
  await admin.doc("patients/demo-sparse").update({ synthetic: true });
});

test("clearing every open flag after action, in one transaction; history stays", async () => {
  const db = firestoreAs(CLINICIAN);
  const state = await firstState((onChange) => subscribePatient(FS, db, "demo-declining", { clock, sections: "attention" }, onChange), allLoaded);
  const open = state.patient?.activeFlags.map((/** @type {any} */ f) => f.id) ?? [];
  assert.ok(open.length >= 2);
  const result = await clearAttention(FS, db, { patientId: "demo-declining", raw: /** @type {any} */ (state.raw), nowMillis: Date.now() });
  assert.equal(result.ok, true, JSON.stringify(result));
  const record = (await admin.doc("patients/demo-declining").get()).data();
  assert.equal(record?.flagLevel, "green");
  assert.deepEqual(record?.flagReasons, []);

  // A new listener may first answer from the SDK's local copy (fromCache, the design's stale
  // state); the confirmed state follows.
  const afterClear = await firstState(
    (onChange) => subscribePatient(FS, db, "demo-declining", { clock, sections: "attention" }, onChange),
    (s) => allLoaded(s) && !s.fromCache,
  );
  assert.equal(afterClear.patient?.level, "green");
  assert.equal(afterClear.patient?.history.filter((/** @type {any} */ h) => h.action === "Cleared").length, open.length);
});

test("withdrawal: the Patient leaves the roster and their page shows only the withdrawn state", async () => {
  const db = firestoreAs(CLINICIAN);
  await admin.doc("patients/demo-steady").update({ sharingConsent: "declined", sharingChangedAtMillis: Date.now() });
  try {
    // A Demo Patient stays readable through the demo shortcut; the record's field decides.
    const page = await firstState((onChange) => subscribePatient(FS, db, "demo-steady", { clock }, onChange), (s) => s.status !== "loading");
    assert.equal(page.status, "withdrawn");
    assert.equal(page.patient?.level, "hidden");
    assert.deepEqual(page.patient?.summaries, []);
    const roster = await firstState(
      (onChange) => subscribeRoster(FS, db, { clinicianEmail: CLINICIAN, clock }, onChange),
      (s) => s.status === "ok" && s.patients.length > 0,
    );
    assert.ok(!roster.patients.some((/** @type {any} */ p) => p.id === "demo-steady"));

    // A live (not synthetic) Patient: the rules refuse the read, which is the same withdrawn state.
    await admin.doc("patients/demo-steady").update({ synthetic: false });
    const live = await firstState((onChange) => subscribePatient(FS, db, "demo-steady", { clock }, onChange), (s) => s.status !== "loading");
    assert.equal(live.status, "withdrawn");
  } finally {
    await admin.doc("patients/demo-steady").update({ sharingConsent: "granted", synthetic: true });
  }
});
