// The silence test command against the Firestore emulator. Run inside the emulators:
//   cd firebase && firebase emulators:exec --only auth,firestore --project demo-twoam "npm --prefix seed run test:emulator"
// That the silence check then raises red, and redFlagAlert emails, is in
// functions/test/emulator/silence.test.ts.
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const PROJECT_ID = process.env.GCLOUD_PROJECT || "demo-twoam";
const HOUR = 60 * 60 * 1000;
const seedDir = fileURLToPath(new URL("../../", import.meta.url));
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST is not set; run this inside firebase emulators:exec");

const app = initializeApp({ projectId: PROJECT_ID }, "silence-test-emulator");
const db = getFirestore(app);
const LIVE = "silence-test-live";
const DEMO = "silence-test-demo";
const PRIVATE = "silence-test-private";
const seenAt = Date.now() - HOUR;

/** @param {string[]} args */
function run(args) {
  return execFileSync(process.execPath, ["silence-test.js", ...args], { cwd: seedDir, env: process.env, encoding: "utf8", stdio: "pipe" });
}

/** @param {string[]} args */
function fails(args) {
  try {
    run(args);
  } catch (error) {
    return String(/** @type {any} */ (error).stderr);
  }
  throw new Error(`silence-test ${args.join(" ")} succeeded`);
}

const base = { displayName: "Live patient", clinicianEmail: "clinician@example.com", sharingConsent: "granted", synthetic: false, lastSeenAtMillis: seenAt };

before(async () => {
  await db.doc(`patients/${LIVE}`).set(base);
  await db.doc(`patients/${DEMO}`).set({ ...base, synthetic: true });
  await db.doc(`patients/${PRIVATE}`).set({ ...base, sharingConsent: "declined" });
});

after(async () => {
  for (const id of [LIVE, DEMO, PRIVATE]) await db.doc(`patients/${id}`).delete();
  await deleteApp(app);
});

test("sets a live Patient's last sign of life to 25 hours ago and changes nothing else", async () => {
  const before = Date.now();
  const output = run(["--patient", LIVE]);
  const after = Date.now();
  assert.match(output, /25 hours ago/);
  assert.match(output, /do not run in the emulator/);

  const stored = /** @type {Record<string, unknown>} */ ((await db.doc(`patients/${LIVE}`).get()).data());
  const lastSeen = /** @type {number} */ (stored.lastSeenAtMillis);
  assert.ok(lastSeen >= before - 25 * HOUR && lastSeen <= after - 25 * HOUR, "not 25 hours ago");
  assert.deepEqual({ ...stored, lastSeenAtMillis: seenAt }, base);
  assert.equal((await db.collection(`patients/${LIVE}/flags`).get()).size, 0, "the command wrote a flag itself");
});

test("refuses a Demo Patient, a Patient not sharing and a missing one, writing nothing", async () => {
  assert.match(fails(["--patient", DEMO]), /never silent/);
  assert.match(fails(["--patient", PRIVATE]), /not sharing/);
  assert.match(fails(["--patient", "silence-test-nobody"]), /No Patient record/);
  for (const id of [DEMO, PRIVATE]) {
    assert.equal((await db.doc(`patients/${id}`).get()).data()?.lastSeenAtMillis, seenAt);
  }
  assert.equal((await db.doc("patients/silence-test-nobody").get()).exists, false);
});
