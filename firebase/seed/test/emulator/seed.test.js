// The seed command against the Firestore emulator, then a read-back as the Clinician under the
// security rules. Run inside the emulators:
//   cd firebase && firebase emulators:exec --only auth,firestore --project demo-twoam "npm --prefix seed run test:emulator"
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { patientListRows } from "../../../hosting/js/lib/list-row.js";
import { newestOpenFlagAt } from "../../../hosting/js/lib/sort.js";
import { demoToday, generateDemoPatients } from "../../src/generate.js";
import { SEEDED_COLLECTIONS } from "../../src/firestore.js";
import { clinicianListFilters } from "../../../hosting/js/lib/sharing.js";

// The dashboard's list query (#29): the rules reject it without the sharing filter.
/** @param {string} email */
const listFilters = (email) => clinicianListFilters(email).map(([field, op, value]) => where(field, op, value));

const PROJECT_ID = process.env.GCLOUD_PROJECT || "demo-twoam";
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
const CLINICIAN = "clinician@example.com";
const DEMO_IDS = ["demo-declining", "demo-sparse", "demo-steady"];
const seedDir = fileURLToPath(new URL("../../", import.meta.url));

if (!EMULATOR) throw new Error("FIRESTORE_EMULATOR_HOST is not set; run this inside firebase emulators:exec");
const [host, port] = EMULATOR.split(":");

const app = initializeApp({ projectId: PROJECT_ID }, "seed-emulator-test");
const db = getFirestore(app);
/** @type {import("@firebase/rules-unit-testing").RulesTestEnvironment} */
let rules;

/** @param {string[]} args */
function runSeed(args) {
  return execFileSync(process.execPath, ["seed.js", ...args], { cwd: seedDir, env: process.env, encoding: "utf8" });
}

before(async () => {
  await fetch(`http://${EMULATOR}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  rules = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host, port: Number(port), rules: readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8") },
  });
  // A live Patient of the same Clinician, which reseeding must leave alone.
  await db.doc("patients/live-1").set({ displayName: "Live patient", clinicianEmail: CLINICIAN, synthetic: false });
});

after(async () => {
  await rules?.cleanup();
  await deleteApp(app);
});

test("one command deletes the previous Demo Patients and recreates them", async () => {
  // An older seed, then a reseed for today: nothing from the older one may survive.
  runSeed(["--today", "2026-10-01"]);
  const output = runSeed([]);
  assert.match(output, /Deleted 3 Demo Patient\(s\): demo-declining, demo-sparse, demo-steady\./);
  assert.match(output, /Created demo-steady, demo-declining, demo-sparse/);

  const today = demoToday(Date.now());
  const expected = generateDemoPatients({ today, nowMillis: Date.now() });
  const synthetic = await db.collection("patients").where("synthetic", "==", true).get();
  assert.deepEqual(synthetic.docs.map((d) => d.id).sort(), DEMO_IDS);
  assert.ok((await db.doc("patients/live-1").get()).exists, "the live Patient was deleted");

  for (const demo of expected) {
    const ref = db.collection("patients").doc(demo.id);
    const stored = (await ref.get()).data();
    assert.equal(stored?.synthetic, true);
    assert.equal(stored?.healthSource, "synthetic");
    assert.equal(stored?.sharingConsent, "granted");
    assert.equal(stored?.flagLevel, demo.patient.flagLevel);
    assert.deepEqual(stored?.flagReasons, demo.patient.flagReasons);
    assert.equal(stored?.tmsEndDate, demo.patient.tmsEndDate);
    for (const name of SEEDED_COLLECTIONS) {
      const docs = await ref.collection(name).get();
      assert.deepEqual(docs.docs.map((d) => d.id).sort(), demo[name].map((e) => e.id).sort(), `${demo.id}/${name}`);
    }
    const daily = await ref.collection("daily").orderBy("date").get();
    assert.equal(daily.size, 42);
    assert.equal(daily.docs.at(-1)?.id, today);
    // Explicit nulls are stored as nulls, not dropped.
    const first = daily.docs[0].data();
    assert.equal(Object.keys(first.vsBaseline).length, 9);
    assert.ok(Object.values(first.vsBaseline).every((v) => v === null));
  }
});

test("the Clinician's list query sees all three Demo Patients under the rules", async () => {
  const clinician = rules.authenticatedContext("clinician-uid", { email: CLINICIAN }).firestore();
  const list = await assertSucceeds(getDocs(query(collection(clinician, "patients"), ...listFilters(CLINICIAN))));
  const ids = list.docs.map((d) => d.id);
  for (const id of DEMO_IDS) assert.ok(ids.includes(id), `${id} missing from the Clinician's list`);
  // The list also reads each Patient's flags, for the newest-flag order.
  const flags = await assertSucceeds(getDocs(collection(clinician, "patients", "demo-declining", "flags")));
  assert.ok(flags.size >= 3);
  assert.ok(flags.docs.some((d) => d.data().level === "red"));
});

test("a signed-out visitor cannot read the Demo Patients", async () => {
  const visitor = rules.unauthenticatedContext().firestore();
  await assertFails(getDocs(query(collection(visitor, "patients"), ...listFilters(CLINICIAN))));
});

test("the dashboard list orders them red, amber, green and re-sorts live when a flag changes", async () => {
  const clinician = rules.authenticatedContext("clinician-uid", { email: CLINICIAN }).firestore();
  /** @type {Record<string, number | null>} */
  const latestFlagAt = {};
  for (const id of DEMO_IDS) {
    const flags = await getDocs(collection(clinician, "patients", id, "flags"));
    latestFlagAt[id] = newestOpenFlagAt(/** @type {any[]} */ (flags.docs.map((d) => d.data())));
  }
  /** @type {string[][]} */
  const orders = [];
  /** @type {(order: string[]) => void} */
  let onOrder = () => {};
  const stop = onSnapshot(query(collection(clinician, "patients"), ...listFilters(CLINICIAN)), (snapshot) => {
    const docs = snapshot.docs.map((d) => ({ id: d.id, data: d.data() }));
    const order = patientListRows(docs, latestFlagAt, { nowMillis: Date.now() })
      .map((row) => row.id)
      .filter((id) => DEMO_IDS.includes(id));
    orders.push(order);
    onOrder(order);
  });
  /** @param {string[]} expected */
  const waitFor = (expected) =>
    new Promise((resolve, reject) => {
      if (JSON.stringify(orders.at(-1)) === JSON.stringify(expected)) return resolve(undefined);
      const timeout = setTimeout(() => reject(new Error(`list order never became ${expected}; saw ${JSON.stringify(orders)}`)), 10_000);
      onOrder = (order) => {
        if (JSON.stringify(order) === JSON.stringify(expected)) {
          clearTimeout(timeout);
          resolve(undefined);
        }
      };
    });
  try {
    await waitFor(["demo-declining", "demo-sparse", "demo-steady"]);
    // A new red flag on the steady Patient, as the phone would raise it: it is now the newest red.
    const raisedAtMillis = Date.now();
    await db.doc("patients/demo-steady/flags/inactive-live").set({
      level: "red", kind: "inactive", reason: "No steps and no screen use for a day.", raisedAtMillis, clearedAtMillis: null,
    });
    latestFlagAt["demo-steady"] = raisedAtMillis;
    await db.doc("patients/demo-steady").update({ flagLevel: "red", flagReasons: ["No steps and no screen use for a day."] });
    await waitFor(["demo-steady", "demo-declining", "demo-sparse"]);
  } finally {
    stop();
  }
});
