// The Attention work queue (#10) against the emulators, with the dashboard's own helpers: the red
// banner over the seeded Demo Patients, a new red flag arriving live, and "Clear after follow-up"
// run as the Clinician under the security rules. Run inside the emulators:
//   cd firebase && firebase emulators:exec --only auth,firestore --project demo-twoam "npm --prefix seed run test:emulator"
import { assertFails, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { collection, doc, getDoc, getDocs, onSnapshot, query, runTransaction, where } from "firebase/firestore";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { newRedFlags } from "../../../hosting/js/lib/banner.js";
import { clearFlags, levelAfterClearing, reviewOf } from "../../../hosting/js/lib/clear.js";
import { listViewModel } from "../../../hosting/js/lib/list-filter.js";
import { patientListRows } from "../../../hosting/js/lib/list-row.js";
import { clinicianListFilters, patientCollectionQuery } from "../../../hosting/js/lib/sharing.js";

const PROJECT_ID = process.env.GCLOUD_PROJECT || "demo-twoam";
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
const CLINICIAN = "clinician@example.com";
const DECLINING = "demo-declining";
const seedDir = fileURLToPath(new URL("../../", import.meta.url));
/** The Firestore functions the dashboard passes to clearFlags, here from the npm SDK. */
const FIRESTORE = { collection, query, where, doc, getDocs, runTransaction };

if (!EMULATOR) throw new Error("FIRESTORE_EMULATOR_HOST is not set; run this inside firebase emulators:exec");
const [host, port] = EMULATOR.split(":");

const app = initializeApp({ projectId: PROJECT_ID }, "attention-emulator-test");
const admin = getFirestore(app);
/** @type {import("@firebase/rules-unit-testing").RulesTestEnvironment} */
let rules;

/** @param {string} email */
const firestoreAs = (email) => /** @type {any} */ (rules.authenticatedContext(`uid-${email}`, { email }).firestore());

/**
 * One Patient's flags as the dashboard holds them: through the dashboard's own query, with the
 * sharing filter.
 * @param {any} db
 * @param {string} patientId
 * @returns {Promise<any[]>}
 */
async function flagsOf(db, patientId) {
  const snapshot = await getDocs(patientCollectionQuery(FIRESTORE, db, patientId, "flags"));
  return snapshot.docs.map((d) => ({ ...d.data(), id: d.id }));
}

/** @param {any} db @param {string} patientId */
async function patientOf(db, patientId) {
  return /** @type {any} */ ((await getDoc(doc(db, "patients", patientId))).data());
}

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

test("the banner shows the declining Demo Patient's red flag, and search and the level filter never hide it", async () => {
  const db = firestoreAs(CLINICIAN);
  const list = await getDocs(query(collection(db, "patients"), ...clinicianListFilters(CLINICIAN).map((f) => where(...f))));
  const docs = list.docs.map((d) => ({ id: d.id, data: d.data() }));
  /** @type {Record<string, any[]>} */
  const flagsByPatient = {};
  for (const { id } of docs) flagsByPatient[id] = await flagsOf(db, id);
  const rows = patientListRows(docs, {}, { nowMillis: Date.now() }, flagsByPatient);

  const unfiltered = listViewModel({ rows, flagsByPatient });
  assert.ok(unfiltered.banner, "no banner for the seeded red flag");
  assert.deepEqual(unfiltered.banner.items.map((i) => i.patientId), [DECLINING]);

  const filtered = listViewModel({ rows, flagsByPatient, search: "steady", level: "green" });
  assert.ok(filtered.rows.every((r) => r.id !== DECLINING));
  assert.deepEqual(filtered.banner, unfiltered.banner);
});

test("a red flag raised while the dashboard listens is new; the first snapshot is not", async () => {
  const db = firestoreAs(CLINICIAN);
  const loadedAtMillis = Date.now();
  /** @type {any[] | null} */
  let previous = null;
  /** @type {any[][]} */
  const detected = [];
  /** @type {() => void} */
  let onNew = () => {};
  const flagsQuery = /** @type {import("firebase/firestore").Query} */ (patientCollectionQuery(FIRESTORE, db, "demo-steady", "flags"));
  const stop = onSnapshot(flagsQuery, (snapshot) => {
    const current = snapshot.docs.map((d) => ({ ...d.data(), id: d.id }));
    const fresh = newRedFlags(previous, current, { loadedAtMillis });
    previous = current;
    detected.push(fresh);
    if (fresh.length) onNew();
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.deepEqual(detected[0], [], "the first snapshot played as new");
    const arrived = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("the new red flag was not detected within 5 seconds")), 5_000);
      onNew = () => {
        clearTimeout(timeout);
        resolve(undefined);
      };
    });
    const batch = admin.batch();
    batch.set(admin.doc("patients/demo-steady/flags/inactive-live"), {
      level: "red", kind: "inactive", reason: "No steps and no screen use for a day.", raisedAtMillis: Date.now(), clearedAtMillis: null,
      sharedWithClinician: true,
    });
    batch.update(admin.doc("patients/demo-steady"), { flagLevel: "red", flagReasons: ["No steps and no screen use for a day."] });
    await batch.commit();
    await arrived;
    assert.deepEqual(detected.at(-1)?.map((f) => f.id), ["inactive-live"]);
  } finally {
    stop();
  }
});

test("Clear after follow-up, as the Clinician: sets the cleared time and resets the level to the highest remaining flag", async () => {
  const db = firestoreAs(CLINICIAN);
  const flags = await flagsOf(db, DECLINING);
  const patient = await patientOf(db, DECLINING);
  assert.equal(patient.flagLevel, "red");
  const red = flags.find((f) => f.level === "red" && f.clearedAtMillis === null);
  assert.ok(red, "the declining Demo Patient has no open red flag");
  const expected = levelAfterClearing(flags, [red.id]);
  assert.equal(expected.flagLevel, "amber", "the seed should leave amber flags open under the red one");

  const nowMillis = Date.now();
  const result = await clearFlags(FIRESTORE, db, { patientId: DECLINING, flagIds: [red.id], reviewed: reviewOf(patient, flags), nowMillis });
  assert.deepEqual(result, expected);

  const stored = (await admin.doc(`patients/${DECLINING}`).get()).data();
  assert.equal(stored?.flagLevel, "amber");
  assert.deepEqual(stored?.flagReasons, expected.flagReasons);
  const cleared = (await admin.doc(`patients/${DECLINING}/flags/${red.id}`).get()).data();
  assert.equal(cleared?.clearedAtMillis, nowMillis);
  // History stays: every flag is still there, and the others are untouched.
  /** @type {any[]} */
  const after = (await admin.collection(`patients/${DECLINING}/flags`).get()).docs.map((d) => ({ ...d.data(), id: d.id }));
  assert.equal(after.length, flags.length);
  for (const f of flags.filter((f) => f.id !== red.id)) {
    assert.equal(after.find((a) => a.id === f.id)?.clearedAtMillis, f.clearedAtMillis);
  }
});

test("a reason raised after the review asks for a new review and writes nothing", async () => {
  const db = firestoreAs(CLINICIAN);
  const flags = await flagsOf(db, DECLINING);
  const patient = await patientOf(db, DECLINING);
  const reviewed = reviewOf(patient, flags);
  const target = flags.find((f) => f.clearedAtMillis === null);
  assert.ok(target);

  // The phone raises a new red flag (flag and level in one batch) while the dialog is open.
  const batch = admin.batch();
  batch.set(admin.doc(`patients/${DECLINING}/flags/crisis-live`), {
    level: "red", kind: "crisis", reason: "Spoke about not wanting to go on during the Check-in.", raisedAtMillis: Date.now(), clearedAtMillis: null,
    sharedWithClinician: true,
  });
  batch.update(admin.doc(`patients/${DECLINING}`), { flagLevel: "red", flagReasons: ["Spoke about not wanting to go on during the Check-in.", ...patient.flagReasons] });
  await batch.commit();

  await assert.rejects(
    clearFlags(FIRESTORE, db, { patientId: DECLINING, flagIds: [target.id], reviewed, nowMillis: Date.now() }),
    (/** @type {any} */ error) => error.code === "flag/changed",
  );
  assert.equal((await admin.doc(`patients/${DECLINING}/flags/${target.id}`).get()).data()?.clearedAtMillis, null);
  assert.equal((await admin.doc(`patients/${DECLINING}`).get()).data()?.flagLevel, "red");

  // After a new review, the same clear goes through and the new red keeps the level red.
  const fresh = await flagsOf(db, DECLINING);
  const result = await clearFlags(FIRESTORE, db, {
    patientId: DECLINING, flagIds: [target.id], reviewed: reviewOf(await patientOf(db, DECLINING), fresh), nowMillis: Date.now(),
  });
  assert.equal(result.flagLevel, "red");
  assert.equal(result.flagReasons[0], "Spoke about not wanting to go on during the Check-in.");
});

test("another Clinician cannot clear the flag", async () => {
  const clinician = firestoreAs(CLINICIAN);
  const flags = await flagsOf(clinician, DECLINING);
  const reviewed = reviewOf(await patientOf(clinician, DECLINING), flags);
  const open = flags.find((f) => f.clearedAtMillis === null);
  assert.ok(open);
  await assertFails(
    clearFlags(FIRESTORE, firestoreAs("other-clinician@example.com"), { patientId: DECLINING, flagIds: [open.id], reviewed, nowMillis: Date.now() }),
  );
});

test("a flag raised while the Patient was not sharing is never shown and never counts", async () => {
  const db = firestoreAs(CLINICIAN);
  // A flag stamped false, as the phone writes it while sharing is off; the record is left alone.
  await admin.doc(`patients/${DECLINING}/flags/drift-hidden`).set({
    level: "red", kind: "inactive", reason: "Raised while the Patient was not sharing.", raisedAtMillis: Date.now(), clearedAtMillis: null,
    sharedWithClinician: false,
  });
  const flags = await flagsOf(db, DECLINING);
  assert.ok(flags.every((f) => f.id !== "drift-hidden"), "the dashboard's query returned an unshared flag");
  const patient = await patientOf(db, DECLINING);
  const rows = patientListRows([{ id: DECLINING, data: patient }], {}, { nowMillis: Date.now() }, { [DECLINING]: flags });
  assert.ok(rows[0].reasons.every((r) => !r.includes("not sharing")));
  // Clearing what is visible works, and the hidden flag stays as it was.
  const open = flags.find((f) => f.clearedAtMillis === null);
  assert.ok(open);
  await clearFlags(FIRESTORE, db, { patientId: DECLINING, flagIds: [open.id], reviewed: reviewOf(patient, flags), nowMillis: Date.now() });
  assert.equal((await admin.doc(`patients/${DECLINING}/flags/drift-hidden`).get()).data()?.clearedAtMillis, null);
});
