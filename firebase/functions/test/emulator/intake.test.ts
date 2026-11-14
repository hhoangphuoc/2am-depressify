// Intake against the emulators.
//
// 1. The handlers with the Admin SDK store against the Firestore emulator (text model faked): the
//    Patient record ends up with the highlights and every other field unchanged.
// 2. When the Functions emulator is running too, the deployed callables are called through the
//    Firebase JS SDK as the dashboard calls them. Only paths that stop before the text model are
//    exercised there, so no request ever reaches Gemini:
//      cd firebase/functions && npm run build && cd ..
//      firebase emulators:exec --only auth,firestore,functions --project demo-twoam "npm --prefix functions run test:emulator"
import { deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { extractIntakeHandler, saveIntakeHandler, adminPatientStore } from "../../src/intakeFunctions";
import { newPatientDoc, type PatientDoc } from "../../src/types";
import { FakeTextModel, failingTextModel } from "../fakes";
import { clinicianToken, signInClinician } from "./accounts";
import { REGION } from "../../src/region";

const PROJECT_ID = "demo-twoam";
const HOST = "127.0.0.1";
const CLINICIAN = { email: "clinician@example.com", password: "demo-password-1" };
const OTHER = { email: "other-clinician@example.com", password: "demo-password-2" };
const PATIENT_ID = "intake-emulator-patient";
const REPORT = "Fictional report for the emulator test. Plays chess on Sundays with a brother.";
const HIGHLIGHTS = "- Plays chess on Sundays with a brother.";

const adminApp = initializeAdminApp({ projectId: PROJECT_ID }, "intake-admin");
const adminDb = getAdminFirestore(adminApp);
const patients = adminPatientStore(adminDb);
const clinicianAuth = { uid: "clinician-uid", token: clinicianToken(CLINICIAN.email) };

/** A Patient record with every field set to something other than its default. */
const ORIGINAL: PatientDoc = {
  ...newPatientDoc("Intake emulator patient", CLINICIAN.email),
  intakeHighlights: "- Older highlights.",
  tmsEndDate: "2026-10-01",
  flagLevel: "amber",
  flagReasons: ["Sleep has been worse than usual on each of the last three nights."],
  lastSeenAtMillis: 1_700_000_000_000,
  lastCheckInAtMillis: 1_700_000_100_000,
  sharingConsent: "granted",
  sharingChangedAtMillis: 1_699_000_000_000,
};

async function patientDoc(): Promise<Record<string, unknown> | undefined> {
  return (await adminDb.collection("patients").doc(PATIENT_ID).get()).data();
}

beforeEach(async () => {
  await adminDb.collection("patients").doc(PATIENT_ID).set(ORIGINAL);
});

afterAll(async () => {
  await adminDb.collection("patients").doc(PATIENT_ID).delete();
  await deleteAdminApp(adminApp);
});

describe("Intake handlers with the Admin SDK on the Firestore emulator", () => {
  it("extract writes nothing; save writes the highlights and changes nothing else", async () => {
    const extracted = await extractIntakeHandler(
      { data: { patientId: PATIENT_ID, reportText: REPORT }, auth: clinicianAuth },
      { patients, textModel: new FakeTextModel(HIGHLIGHTS) },
    );
    expect(extracted.highlights).toBe(HIGHLIGHTS);
    expect(await patientDoc()).toEqual(ORIGINAL);

    await saveIntakeHandler({ data: { patientId: PATIENT_ID, highlights: extracted.highlights }, auth: clinicianAuth }, { patients });

    expect(await patientDoc()).toEqual({ ...ORIGINAL, intakeHighlights: HIGHLIGHTS });
  });

  it("a failed extract and a refused save leave the record as it was", async () => {
    await expect(
      extractIntakeHandler({ data: { patientId: PATIENT_ID, reportText: REPORT }, auth: clinicianAuth }, { patients, textModel: failingTextModel() }),
    ).rejects.toMatchObject({ code: "unavailable" });
    await expect(
      saveIntakeHandler(
        { data: { patientId: PATIENT_ID, highlights: HIGHLIGHTS }, auth: { uid: "x", token: clinicianToken(OTHER.email) } },
        { patients },
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(await patientDoc()).toEqual(ORIGINAL);
  });

  it("a save for a missing Patient creates no record", async () => {
    await expect(
      saveIntakeHandler({ data: { patientId: "no-such-patient", highlights: HIGHLIGHTS }, auth: clinicianAuth }, { patients }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect((await adminDb.collection("patients").doc("no-such-patient").get()).exists).toBe(false);
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

describe.skipIf(!withFunctions)("Intake callables through the Functions emulator", () => {
  const apps: FirebaseApp[] = [];

  function client(name: string) {
    const app = initializeApp({ projectId: PROJECT_ID, apiKey: "demo-api-key" }, name);
    apps.push(app);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${HOST}:9099`, { disableWarnings: true });
    const functions = getFunctions(app, REGION);
    connectFunctionsEmulator(functions, HOST, 5001);
    return {
      auth,
      extract: httpsCallable(functions, "extractIntake"),
      save: httpsCallable(functions, "saveIntake"),
    };
  }

  async function signedIn(name: string, account: { email: string; password: string }) {
    const c = client(name);
    await signInClinician(adminApp, c.auth, account);
    return c;
  }

  let dashboard: ReturnType<typeof client>;
  let other: ReturnType<typeof client>;
  let phone: ReturnType<typeof client>;

  beforeAll(async () => {
    dashboard = await signedIn("intake-dashboard", CLINICIAN);
    other = await signedIn("intake-other", OTHER);
    phone = client("intake-phone");
    await signInAnonymously(phone.auth);
  });

  afterAll(async () => {
    await Promise.all(apps.map((app) => deleteApp(app)));
  });

  it("the Clinician saves highlights; the record changes in that field only", async () => {
    const result = await dashboard.save({ patientId: PATIENT_ID, highlights: `${HIGHLIGHTS}\n` });
    expect(result.data).toEqual({ intakeHighlights: HIGHLIGHTS, wordCount: 7 });
    expect(await patientDoc()).toEqual({ ...ORIGINAL, intakeHighlights: HIGHLIGHTS });
  });

  it("over-limit highlights are refused on save", async () => {
    const tooLong = Array.from({ length: 121 }, (_, i) => `w${i}`).join(" ");
    await expect(dashboard.save({ patientId: PATIENT_ID, highlights: tooLong })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    expect(await patientDoc()).toEqual(ORIGINAL);
  });

  it("another Clinician and the anonymous Patient are refused", async () => {
    await expect(other.save({ patientId: PATIENT_ID, highlights: HIGHLIGHTS })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(phone.save({ patientId: PATIENT_ID, highlights: HIGHLIGHTS })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(other.extract({ patientId: PATIENT_ID, reportText: REPORT })).rejects.toMatchObject({ code: "functions/permission-denied" });
    expect(await patientDoc()).toEqual(ORIGINAL);
  });

  it("an empty report is refused before the model is called", async () => {
    await expect(dashboard.extract({ patientId: PATIENT_ID, reportText: "   \n " })).rejects.toMatchObject({ code: "functions/invalid-argument" });
  });
});
