// The live demo Patient command against the Auth and Firestore emulators: it creates the account
// and the mock history, --reset recreates the history and leaves everything else alone, and under
// the security rules the owner and their Clinician can read it through the app's and the
// dashboard's queries. Run inside the emulators:
//   cd firebase && firebase emulators:exec --only auth,firestore --project demo-twoam "npm --prefix seed run test:emulator"
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { shownAttention } from "../../../hosting/js/lib/clear.js";
import { clinicianListFilters, patientCollectionQuery } from "../../../hosting/js/lib/sharing.js";
import { SEEDED_COLLECTIONS } from "../../src/firestore.js";
import { makeLivePatient } from "../../src/live-patient.js";

const FS = { collection, query, where };
const PROJECT_ID = process.env.GCLOUD_PROJECT || "demo-twoam";
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const CLINICIAN = "clinician@example.com";
const PATIENT_EMAIL = "live.patient@example.com";
const TODAY = "2026-11-14";
const seedDir = fileURLToPath(new URL("../../", import.meta.url));

if (!EMULATOR || !AUTH_EMULATOR) {
  throw new Error("FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST must be set; run this inside firebase emulators:exec --only auth,firestore");
}
const [host, port] = EMULATOR.split(":");

const app = initializeApp({ projectId: PROJECT_ID }, "live-patient-emulator-test");
const db = getFirestore(app);
const auth = getAuth(app);
/** @type {import("@firebase/rules-unit-testing").RulesTestEnvironment} */
let rules;
/** The account's uid, once the command has created it. */
let uid = "";

/** @param {string[]} args */
function run(args) {
  return execFileSync(process.execPath, ["seed-live-patient.js", ...args], { cwd: seedDir, env: process.env, encoding: "utf8", stdio: "pipe" });
}

/** @param {string[]} args @returns {string} stderr */
function fails(args) {
  try {
    run(args);
  } catch (error) {
    return String(/** @type {any} */ (error).stderr);
  }
  throw new Error(`seed-live-patient ${args.join(" ")} succeeded`);
}

/** Everything under a Patient, as {collection/id: data}. @param {string} id */
async function snapshotOf(id) {
  const ref = db.collection("patients").doc(id);
  /** @type {Record<string, unknown>} */
  const out = { record: (await ref.get()).data() ?? null };
  for (const name of [...SEEDED_COLLECTIONS, "digests"]) {
    for (const d of (await ref.collection(name).get()).docs) out[`${name}/${d.id}`] = d.data();
  }
  return out;
}

const expected = () => makeLivePatient({ patientId: uid, clinicianEmail: CLINICIAN, today: TODAY });

before(async () => {
  await fetch(`http://${EMULATOR}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });
  rules = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host, port: Number(port), rules: readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8") },
  });
  // The Demo Patients, the allowlist, and another live Patient, none of which the command may touch.
  execFileSync(process.execPath, ["seed.js", "--today", TODAY], { cwd: seedDir, env: process.env, encoding: "utf8" });
  await db.doc("patients/other-live").set({ displayName: "Other", clinicianEmail: CLINICIAN, synthetic: false, sharingConsent: "granted" });
  await db.doc("patients/other-live/checkIns/demo-checkin-2026-11-01").set({ id: "demo-checkin-2026-11-01", note: "another Patient's" });
});

after(async () => {
  await rules?.cleanup();
  await deleteApp(app);
});

test("creates the account with a verified email, no password and no claims, then the mock history", async () => {
  const before = { other: await snapshotOf("other-live"), steady: await snapshotOf("demo-steady") };
  const output = run(["--email", PATIENT_EMAIL, "--today", TODAY]);
  const match = /Created the account: uid (\S+) \(email verified, no password\)\./.exec(output);
  assert.ok(match, output);
  uid = match[1];
  // The email is printed once, masked, and never in full.
  assert.ok(!output.includes(PATIENT_EMAIL) && !output.includes("live.patient"), output);
  assert.match(output, /l•••@e•••\.com/);
  assert.match(output, /Attention: amber/);

  const user = await auth.getUserByEmail(PATIENT_EMAIL);
  assert.equal(user.uid, uid);
  assert.equal(user.emailVerified, true);
  assert.equal(user.displayName, "Alex");
  assert.equal(user.passwordHash, undefined);
  assert.ok(!user.providerData.some((p) => p.providerId === "password"));
  assert.deepEqual(user.customClaims ?? {}, {});

  const generated = expected();
  const stored = await snapshotOf(uid);
  assert.deepEqual(stored.record, generated.patient);
  for (const name of SEEDED_COLLECTIONS) {
    const ids = Object.keys(stored).filter((k) => k.startsWith(`${name}/`)).map((k) => k.slice(name.length + 1)).sort();
    assert.deepEqual(ids, generated[name].map((e) => e.id).sort(), name);
    for (const entry of generated[name]) assert.deepEqual(stored[`${name}/${entry.id}`], entry.data, `${name}/${entry.id}`);
  }
  assert.deepEqual(await snapshotOf("other-live"), before.other);
  assert.deepEqual(await snapshotOf("demo-steady"), before.steady);
});

test("the owner, signed in with that account, reads everything through the app's queries", async () => {
  const owner = rules.authenticatedContext(uid, { email: PATIENT_EMAIL, email_verified: true, firebase: { sign_in_provider: "google.com" } }).firestore();
  const generated = expected();
  const record = await assertSucceeds(getDoc(doc(owner, "patients", uid)));
  assert.equal(record.data()?.flagLevel, "amber");
  for (const name of SEEDED_COLLECTIONS) {
    const all = await assertSucceeds(getDocs(collection(owner, "patients", uid, name)));
    assert.equal(all.size, generated[name].length, name);
  }
  // What the Companion's tools read (CompanionTools, FirebaseCheckInGateway).
  const days = await assertSucceeds(getDocs(query(collection(owner, "patients", uid, "daily"), orderBy("date", "desc"), limit(7))));
  assert.equal(days.docs[0].id, TODAY);
  const recent = await assertSucceeds(getDocs(query(collection(owner, "patients", uid, "summaries"), orderBy("createdAtMillis", "desc"), limit(3))));
  assert.equal(recent.size, 3);
  const last = await assertSucceeds(getDocs(query(collection(owner, "patients", uid, "suggestions"), orderBy("suggestedAtMillis", "desc"), limit(1))));
  assert.equal(last.docs[0].data().status, "accepted");
  assert.equal(last.docs[0].data().tried, null);
});

test("anyone else signed in cannot read it: the record is not synthetic", async () => {
  const stranger = rules.authenticatedContext("someone-else", { firebase: { sign_in_provider: "anonymous" } }).firestore();
  await assertFails(getDoc(doc(stranger, "patients", uid)));
  await assertFails(getDocs(collection(stranger, "patients", uid, "summaries")));
  const otherClinician = rules.authenticatedContext("other-clinician", { email: "other.clinician@example.com", email_verified: true, role: "clinician" }).firestore();
  await assertFails(getDoc(doc(otherClinician, "patients", uid)));
});

test("the allowlisted Clinician reads it through the dashboard's queries", async () => {
  const clinician = rules.authenticatedContext("clinician-uid", { email: CLINICIAN, email_verified: true, role: "clinician" }).firestore();
  const list = await assertSucceeds(
    getDocs(query(collection(clinician, "patients"), ...clinicianListFilters(CLINICIAN).map(([f, op, v]) => where(f, op, v)))),
  );
  assert.ok(list.docs.some((d) => d.id === uid), "missing from the Clinician's list");
  const generated = expected();
  for (const name of SEEDED_COLLECTIONS) {
    const shown = await assertSucceeds(getDocs(patientCollectionQuery(FS, clinician, uid, name)));
    assert.equal(shown.size, generated[name].length, name);
  }
  const flags = await getDocs(patientCollectionQuery(FS, clinician, uid, "flags"));
  const attention = shownAttention({}, flags.docs.map((d) => ({ id: d.id, ...d.data() })));
  assert.equal(attention.flagLevel, "amber");
  assert.deepEqual(attention.flagReasons, generated.patient.flagReasons);
});

test("without --reset it refuses to write over the mock history", () => {
  assert.match(fails(["--email", PATIENT_EMAIL, "--today", TODAY]), /already has mock history .* Pass --reset/);
});

test("--reset deletes and recreates exactly the mock history; what the app wrote is left alone", async () => {
  const ref = db.collection("patients").doc(uid);
  const generated = expected();
  // What the app and functions wrote since: a Check-in, a crisis flag, today's daily record, a Digest.
  const endedAtMillis = /** @type {number} */ (generated.patient.lastCheckInAtMillis) + 3_600_000;
  const app = {
    "checkIns/0b6f4f7e-1111-4c4c-9d9d-123456789abc": { id: "0b6f4f7e-1111-4c4c-9d9d-123456789abc", startedAtMillis: endedAtMillis - 200_000, endedAtMillis, mood: 3, energy: 3, sleepQuality: 3, voiceCues: [], crisis: false, sharedWithClinician: true },
    [`flags/crisis-${endedAtMillis}`]: { level: "red", kind: "crisis", reason: "The Companion heard signs of a crisis in a Check-in.", raisedAtMillis: endedAtMillis, clearedAtMillis: null, sharedWithClinician: true },
    [`daily/${TODAY}`]: { ...generated.daily.at(-1)?.data, demoOverride: false, values: { ...generated.daily.at(-1)?.data.values, steps: 1234 } },
    "digests/2026-W45": { isoWeek: "2026-W45", text: "A week.", sharedWithClinician: true },
  };
  for (const [path, data] of Object.entries(app)) await ref.collection(path.split("/")[0]).doc(path.split("/")[1]).set(data);
  // Mock history changed since: the Clinician cleared the open flag, and an older run left a Check-in.
  const openFlag = generated.flags.find((f) => f.data.clearedAtMillis === null);
  await ref.collection("flags").doc(/** @type {string} */ (openFlag?.id)).update({ clearedAtMillis: endedAtMillis });
  await ref.collection("checkIns").doc("demo-checkin-2026-09-01").set({ id: "demo-checkin-2026-09-01" });
  const others = { other: await snapshotOf("other-live"), steady: await snapshotOf("demo-steady") };

  const output = run(["--email", PATIENT_EMAIL, "--today", TODAY, "--reset"]);
  assert.match(output, new RegExp(`Found the account: uid ${uid}\\.`));
  assert.match(output, /Deleted mock history: daily 41, consents 0, checkIns 25, summaries 24, suggestions 24, flags \d+, visits 2\./);
  // Today's record is now the app's (demoOverride false): kept, and not counted as mock.
  assert.match(output, /Kept 1 daily record\(s\) the app wrote\./);
  assert.ok(!output.includes(PATIENT_EMAIL));

  const stored = await snapshotOf(uid);
  for (const [path, data] of Object.entries(app)) assert.deepEqual(stored[path], data, path);
  assert.equal(stored["checkIns/demo-checkin-2026-09-01"], undefined, "a stale mock Check-in survived the reset");
  for (const name of SEEDED_COLLECTIONS) {
    for (const entry of generated[name]) {
      if (name === "daily" && entry.id === TODAY) continue;
      assert.deepEqual(stored[`${name}/${entry.id}`], entry.data, `${name}/${entry.id}`);
    }
  }
  // The app's red crisis flag counts toward the level; its Check-in is the latest.
  const record = /** @type {Record<string, unknown>} */ (stored.record);
  assert.equal(record.flagLevel, "red");
  assert.deepEqual(record.flagReasons, ["The Companion heard signs of a crisis in a Check-in.", ...generated.patient.flagReasons]);
  assert.equal(record.lastCheckInAtMillis, endedAtMillis);
  assert.deepEqual(await snapshotOf("other-live"), others.other);
  assert.deepEqual(await snapshotOf("demo-steady"), others.steady);
  // The seed of the Demo Patients leaves the live Patient alone too.
  execFileSync(process.execPath, ["seed.js", "--today", TODAY], { cwd: seedDir, env: process.env, encoding: "utf8" });
  assert.deepEqual(await snapshotOf(uid), stored);
});

test("refuses a real project without a real Clinician, a Clinician's account, and a mixed target", async () => {
  const env = { ...process.env, FIRESTORE_EMULATOR_HOST: "", FIREBASE_AUTH_EMULATOR_HOST: "" };
  const failsWith = (/** @type {string[]} */ args, /** @type {NodeJS.ProcessEnv} */ e) => {
    try {
      execFileSync(process.execPath, ["seed-live-patient.js", ...args], { cwd: seedDir, env: e, encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      return String(/** @type {any} */ (error).stderr);
    }
    throw new Error("succeeded");
  };
  assert.match(failsWith(["--email", PATIENT_EMAIL, "--project", "twoam-prod"], env), /needs the Clinician's email/);
  assert.match(
    failsWith(["--email", PATIENT_EMAIL, "--project", "twoam-prod", "--clinician", "dr.real@example.org"], { ...env, FIREBASE_AUTH_EMULATOR_HOST: AUTH_EMULATOR }),
    /never mixed/,
  );
  // An allowlisted Clinician's email is never made a Patient.
  await db.doc("clinicians/second.clinician@example.com").set({ email: "second.clinician@example.com" });
  assert.match(fails(["--email", "second.clinician@example.com"]), /on the clinicians allowlist/);
  await assert.rejects(auth.getUserByEmail("second.clinician@example.com"));
});
