// The red flag alert against the emulators.
//
// 1. The handler with the Admin SDK store against the Firestore emulator: a red crisis flag of a
//    sharing Patient writes exactly one `mail` document; running the handler again for the same
//    flag (a retried trigger) writes nothing more; amber and a Patient not sharing write none. The
//    flags here are passed to the handler, not written, so the deployed trigger cannot interfere.
// 2. When the Functions emulator is running too, flags are written to Firestore and the deployed
//    `redFlagAlert` trigger reacts to them, as it will in production:
//      cd firebase/functions && npm run build && cd ..
//      firebase emulators:exec --only auth,firestore,functions --project demo-twoam "npm --prefix functions run test:emulator"
import { deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mailIdFor } from "../../src/alerts";
import { adminAlertStore, redFlagAlertHandler } from "../../src/alertFunctions";
import { newPatientDoc, type Flag, type MailDoc } from "../../src/types";

const PROJECT_ID = "demo-twoam";
const CLINICIAN = "clinician@example.com";
const SHARING = "alert-emu-sharing";
const NOT_SHARING = "alert-emu-not-sharing";
const DASHBOARD = "https://dashboard.example.test";

const adminApp = initializeAdminApp({ projectId: PROJECT_ID }, "alert-admin");
const adminDb = getAdminFirestore(adminApp);
const store = adminAlertStore(adminDb);

// A fresh run id keeps flag ids, and so mail ids, unique between runs against the same emulator.
const RUN = `${Date.now()}`;
const createdMail: string[] = [];

function flag(overrides: Partial<Flag> = {}): Flag {
  return {
    level: "red",
    kind: "crisis",
    reason: "A crisis was raised in a Check-in.",
    raisedAtMillis: Date.now(),
    clearedAtMillis: null,
    sharedWithClinician: true,
    ...overrides,
  };
}

async function mailDoc(patientId: string, flagId: string): Promise<MailDoc | undefined> {
  const id = mailIdFor(patientId, flagId);
  createdMail.push(id);
  return (await adminDb.collection("mail").doc(id).get()).data() as MailDoc | undefined;
}

async function patientsMail(): Promise<MailDoc[]> {
  const ids = [SHARING, NOT_SHARING].flatMap((p) => ["crisis", "amber", "trigger-red", "trigger-amber", "trigger-off"].map((f) => mailIdFor(p, `${f}-${RUN}`)));
  const snaps = await Promise.all(ids.map((id) => adminDb.collection("mail").doc(id).get()));
  return snaps.filter((s) => s.exists).map((s) => s.data() as MailDoc);
}

beforeAll(async () => {
  for (const id of [SHARING, NOT_SHARING]) await adminDb.recursiveDelete(adminDb.collection("patients").doc(id));
  await adminDb.collection("patients").doc(SHARING).set({ ...newPatientDoc("Alex Example", CLINICIAN), sharingConsent: "granted" });
  await adminDb.collection("patients").doc(NOT_SHARING).set({ ...newPatientDoc("Sam Example", CLINICIAN), sharingConsent: "declined" });
});

afterAll(async () => {
  for (const id of [SHARING, NOT_SHARING]) await adminDb.recursiveDelete(adminDb.collection("patients").doc(id));
  await Promise.all(createdMail.map((id) => adminDb.collection("mail").doc(id).delete()));
  await deleteAdminApp(adminApp);
});

describe("redFlagAlertHandler with the Admin SDK on the Firestore emulator", () => {
  it("a red crisis flag of a sharing Patient writes exactly one email, and a retried trigger no second one", async () => {
    const flagId = `crisis-${RUN}`;
    const deps = { store, dashboardUrl: DASHBOARD };
    expect(await redFlagAlertHandler({ patientId: SHARING, flagId, flag: flag() }, deps)).toEqual({ outcome: "sent", kind: "crisis" });
    expect(await redFlagAlertHandler({ patientId: SHARING, flagId, flag: flag() }, deps)).toEqual({ outcome: "duplicate", kind: "crisis" });

    const mail = await mailDoc(SHARING, flagId);
    expect(mail?.to).toBe(CLINICIAN);
    expect(mail?.message.subject).toBe("[CRISIS] Red flag for Alex Example: crisis in a Check-in");
    expect(mail?.message.text).toContain(`${DASHBOARD}/#/patient/${SHARING}`);
    expect(await patientsMail()).toHaveLength(1);
  });

  it("an amber flag writes no email", async () => {
    const flagId = `amber-${RUN}`;
    const outcome = await redFlagAlertHandler({ patientId: SHARING, flagId, flag: flag({ level: "amber", kind: "decline" }) }, { store, dashboardUrl: DASHBOARD });
    expect(outcome).toEqual({ outcome: "skipped", skip: "not_red", kind: "decline" });
    expect(await mailDoc(SHARING, flagId)).toBeUndefined();
  });

  it("a red flag of a Patient who is not sharing writes no email", async () => {
    const flagId = `crisis-${RUN}`;
    const outcome = await redFlagAlertHandler({ patientId: NOT_SHARING, flagId, flag: flag() }, { store, dashboardUrl: DASHBOARD });
    expect(outcome).toEqual({ outcome: "skipped", skip: "not_sharing", kind: "crisis" });
    expect(await mailDoc(NOT_SHARING, flagId)).toBeUndefined();
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

/** Polls until the mail document exists, or gives up after `timeoutMs`. */
async function waitForMail(patientId: string, flagId: string, timeoutMs = 15_000): Promise<MailDoc | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const mail = await mailDoc(patientId, flagId);
    if (mail) return mail;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return undefined;
}

describe.skipIf(!withFunctions)("redFlagAlert through the Functions emulator", () => {
  it("a red flag written to Firestore emails once; amber and a Patient not sharing do not", async () => {
    const flags = (patientId: string) => adminDb.collection("patients").doc(patientId).collection("flags");
    // The two that must not email are written first, so by the time the red one's email exists
    // the trigger has had at least as long to act on them.
    await flags(SHARING).doc(`trigger-amber-${RUN}`).set(flag({ level: "amber", kind: "low_mood", reason: "Mood was rated low three times." }));
    await flags(NOT_SHARING).doc(`trigger-off-${RUN}`).set(flag());
    await flags(SHARING).doc(`trigger-red-${RUN}`).set(flag({ kind: "silent", reason: "The phone has been quiet for over a day." }));

    const mail = await waitForMail(SHARING, `trigger-red-${RUN}`);
    expect(mail?.to).toBe(CLINICIAN);
    expect(mail?.message.subject).toBe("[RED] Red flag for Alex Example: quiet phone");
    // The emulator's project id gives the default dashboard link.
    expect(mail?.message.text).toContain(`https://${PROJECT_ID}.web.app/#/patient/${SHARING}`);

    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(await mailDoc(SHARING, `trigger-amber-${RUN}`)).toBeUndefined();
    expect(await mailDoc(NOT_SHARING, `trigger-off-${RUN}`)).toBeUndefined();
  });
});
