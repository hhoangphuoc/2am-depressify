// The weekly Digest against the emulators, with the seeded Demo Patients.
//
// 1. The handlers with the Admin SDK store against the Firestore emulator and a fake text model:
//    "Generate now" on a copy of the declining Demo Patient sends exactly that week's Summaries to
//    the model and writes the Digest; the Monday job writes last week's Digest for every sharing
//    Patient and none for a Patient who is not sharing.
// 2. When the Functions emulator is running too, the deployed `generateDigest` callable is called
//    through the Firebase JS SDK as the dashboard calls it. Only paths that never reach the text
//    model are exercised there (a week with no Check-ins, and refusals), so no request can reach
//    Gemini even with a key in .secret.local:
//      cd firebase/functions && npm run build && cd ..
//      firebase emulators:exec --only auth,firestore,functions --project demo-twoam "npm --prefix functions run test:emulator"
import { deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInAnonymously, signInWithEmailAndPassword } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateDemoPatients } from "../../../seed/src/generate.js";
import { writeDemoPatients } from "../../../seed/src/firestore.js";
import { dateInZone, onDemandPeriod, scheduledPeriod } from "../../src/digest";
import { adminDigestStore, generateDigestHandler, weeklyDigestHandler } from "../../src/digestFunctions";
import { newPatientDoc, type Digest, type Summary } from "../../src/types";
import { FakeTextModel } from "../fakes";

const PROJECT_ID = "demo-twoam";
const HOST = "127.0.0.1";
const REGION = "europe-west1";
const CLINICIAN = { email: "clinician@example.com", password: "demo-password-1" };
const OTHER = { email: "other-clinician@example.com", password: "demo-password-2" };
const DECLINING = "digest-emu-declining";
const SPARSE = "digest-emu-sparse";
const NOT_SHARING = "digest-emu-not-sharing";
const QUIET = "digest-emu-quiet";
const IDS = [DECLINING, SPARSE, NOT_SHARING, QUIET];
const MODEL_TEXT = "The Patient rated mood lower as the week went on. (fake model)";

const adminApp = initializeAdminApp({ projectId: PROJECT_ID }, "digest-admin");
const adminDb = getAdminFirestore(adminApp);
const store = adminDigestStore(adminDb);
const clinicianAuth = { uid: "clinician-uid", token: { email: CLINICIAN.email } };

const nowMillis = Date.now();
const today = dateInZone(nowMillis);
type DemoPatient = ReturnType<typeof generateDemoPatients>[number];
const demo = Object.fromEntries(generateDemoPatients({ today, nowMillis }).map((p: DemoPatient) => [p.profile, p])) as Record<string, DemoPatient>;

/** The seeded Summaries saved while sharing whose Helsinki date falls between two dates, oldest first. */
function seededSummaries(profile: string, from: string, to: string): Summary[] {
  return demo[profile]!.summaries
    .map((entry) => entry.data as Summary)
    .filter((s) => s.sharedWithClinician && dateInZone(s.createdAtMillis) >= from && dateInZone(s.createdAtMillis) <= to)
    .sort((a, b) => a.createdAtMillis - b.createdAtMillis);
}

async function digestDoc(patientId: string, isoWeek: string): Promise<Digest | undefined> {
  return (await adminDb.collection("patients").doc(patientId).collection("digests").doc(isoWeek).get()).data() as Digest | undefined;
}

async function deleteTestPatients() {
  for (const id of IDS) await adminDb.recursiveDelete(adminDb.collection("patients").doc(id));
}

beforeAll(async () => {
  await deleteTestPatients();
  const copy = (profile: string, id: string, overrides: object = {}) => ({
    ...demo[profile]!,
    id,
    patient: { ...demo[profile]!.patient, ...overrides },
  });
  await writeDemoPatients(adminDb, [
    copy("declining", DECLINING),
    copy("sparse", SPARSE),
    copy("declining", NOT_SHARING, { sharingConsent: "declined" }),
  ]);
  await adminDb.collection("patients").doc(QUIET).set({ ...newPatientDoc("Quiet patient", CLINICIAN.email), sharingConsent: "granted" });
});

afterAll(async () => {
  await deleteTestPatients();
  await deleteAdminApp(adminApp);
});

describe("Digest handlers with the Admin SDK on the Firestore emulator", () => {
  it("Generate now on the declining Demo Patient sends that week's Summaries to the model and writes the Digest", async () => {
    const period = onDemandPeriod(nowMillis);
    const expected = seededSummaries("declining", period.weekStart, period.weekEnd);
    const model = new FakeTextModel(MODEL_TEXT);

    const { digest } = await generateDigestHandler(
      { data: { patientId: DECLINING }, auth: clinicianAuth },
      { store, textModel: model, nowMillis: () => nowMillis },
    );

    expect(digest).toMatchObject({ isoWeek: period.isoWeek, weekStart: period.weekStart, weekEnd: today, summaryCount: expected.length });
    expect(await digestDoc(DECLINING, period.isoWeek)).toEqual(digest);

    if (expected.length === 0) {
      // Only on a Monday before the evening Check-in: the week so far has none.
      expect(model.requests).toHaveLength(0);
      expect(digest.text).toMatch(/no Check-ins/i);
      return;
    }
    expect(digest.text).toBe(MODEL_TEXT);
    expect(model.requests).toHaveLength(1);
    const input = model.requests[0]!.input;
    for (const s of expected) {
      expect(input).toContain(dateInZone(s.createdAtMillis));
      expect(input).toContain(JSON.stringify(s.sleepLine).slice(1, -1));
      for (const theme of s.themes) expect(input).toContain(theme);
    }
    // Nothing from before Monday.
    const before = seededSummaries("declining", "0000-01-01", period.weekStart).filter((s) => dateInZone(s.createdAtMillis) < period.weekStart);
    for (const s of before) expect(input).not.toContain(`"date": "${dateInZone(s.createdAtMillis)}"`);
  });

  it("the Monday job writes last week's Digest for each sharing Patient and none for a Patient not sharing", async () => {
    const period = scheduledPeriod(nowMillis);
    const model = new FakeTextModel(MODEL_TEXT);
    const result = await weeklyDigestHandler(nowMillis, { store, textModel: model });
    expect(result.isoWeek).toBe(period.isoWeek);
    expect(result.failed).toBe(0);

    const declining = seededSummaries("declining", period.weekStart, period.weekEnd);
    expect(declining.length).toBeGreaterThan(0);
    expect(await digestDoc(DECLINING, period.isoWeek)).toEqual({
      isoWeek: period.isoWeek,
      weekStart: period.weekStart,
      weekEnd: period.weekEnd,
      summaryCount: declining.length,
      text: MODEL_TEXT,
      generatedAtMillis: nowMillis,
      sharedWithClinician: true,
    });
    // The declining Patient's week reached the model, every Summary of it.
    const sent = model.requests.map((r) => r.input).find((input) => declining.every((s) => s.themes.every((t) => input.includes(t)) && input.includes(dateInZone(s.createdAtMillis))));
    expect(sent).toBeDefined();

    const sparse = await digestDoc(SPARSE, period.isoWeek);
    expect(sparse?.summaryCount).toBe(seededSummaries("sparse", period.weekStart, period.weekEnd).length);

    const quiet = await digestDoc(QUIET, period.isoWeek);
    expect(quiet?.summaryCount).toBe(0);
    expect(quiet?.text).toMatch(/no Check-ins/i);

    expect(await digestDoc(NOT_SHARING, period.isoWeek)).toBeUndefined();
    expect((await adminDb.collection("patients").doc(NOT_SHARING).collection("digests").get()).empty).toBe(true);
  });
});

async function functionsEmulatorRunning(): Promise<boolean> {
  const hub = process.env.FIREBASE_EMULATOR_HUB;
  if (!hub) return false;
  try {
    const emulators = (await (await fetch(`http://${hub}/emulators`)).json()) as Record<string, unknown>;
    return "functions" in emulators;
  } catch {
    return false;
  }
}

const withFunctions = await functionsEmulatorRunning();

describe.skipIf(!withFunctions)("generateDigest through the Functions emulator", () => {
  const apps: FirebaseApp[] = [];

  function client(name: string) {
    const app = initializeApp({ projectId: PROJECT_ID, apiKey: "demo-api-key" }, name);
    apps.push(app);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${HOST}:9099`, { disableWarnings: true });
    const functions = getFunctions(app, REGION);
    connectFunctionsEmulator(functions, HOST, 5001);
    return { auth, generate: httpsCallable(functions, "generateDigest") };
  }

  async function signedIn(name: string, account: { email: string; password: string }) {
    const c = client(name);
    try {
      await createUserWithEmailAndPassword(c.auth, account.email, account.password);
    } catch {
      await signInWithEmailAndPassword(c.auth, account.email, account.password);
    }
    return c;
  }

  let dashboard: ReturnType<typeof client>;
  let other: ReturnType<typeof client>;
  let phone: ReturnType<typeof client>;

  beforeAll(async () => {
    dashboard = await signedIn("digest-dashboard", CLINICIAN);
    other = await signedIn("digest-other", OTHER);
    phone = client("digest-phone");
    await signInAnonymously(phone.auth);
  });

  afterAll(async () => {
    await Promise.all(apps.map((app) => deleteApp(app)));
  });

  it("the Clinician generates a week with no Check-ins: fixed copy, no model call", async () => {
    const period = onDemandPeriod(Date.now());
    const result = (await dashboard.generate({ patientId: QUIET })).data as { digest: Digest };
    expect(result.digest).toMatchObject({ isoWeek: period.isoWeek, weekStart: period.weekStart, summaryCount: 0 });
    expect(result.digest.text).toMatch(/no Check-ins/i);
    expect(await digestDoc(QUIET, period.isoWeek)).toEqual(result.digest);
  });

  it("another Clinician, the anonymous Patient and a Patient not sharing are refused", async () => {
    await expect(other.generate({ patientId: QUIET })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(phone.generate({ patientId: QUIET })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(dashboard.generate({ patientId: NOT_SHARING })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(dashboard.generate({ patientId: "" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    expect((await adminDb.collection("patients").doc(NOT_SHARING).collection("digests").get()).empty).toBe(true);
  });
});
