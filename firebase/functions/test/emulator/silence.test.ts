// The silence check against the emulators.
//
// 1. The handler with the Admin SDK store against the Firestore emulator: a silent sharing Patient
//    gets one red `silent` flag and the record goes red in the same transaction; a second run adds
//    nothing; a Patient seen 23 hours ago, one not sharing, one never seen and a copy of a seeded
//    Demo Patient get nothing. The listing is narrowed to this file's Patients so other suites'
//    records are never flagged.
// 2. When the Functions emulator is running too, the flag the check writes is picked up by the
//    deployed `redFlagAlert` trigger, as in production: the seed's silence test sets a live
//    Patient's last sign of life to 25 hours ago, the next run raises red, and exactly one email is
//    written to `mail`, also after a second run:
//      cd firebase/functions && npm run build && cd ..
//      firebase emulators:exec --only auth,firestore,functions --project demo-twoam "npm --prefix functions run test:emulator"
// The scheduled trigger itself does not run in the emulator (it needs Cloud Scheduler and Pub/Sub);
// its schedule and region are checked in test/silence-handlers.test.ts.
import { deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateDemoPatients } from "../../../seed/src/generate.js";
import { writeDemoPatients } from "../../../seed/src/firestore.js";
import { startSilenceTest } from "../../../seed/src/silence-test.js";
import { mailIdFor } from "../../src/alerts";
import { dateInZone } from "../../src/digest";
import { SILENT_REASON, silentFlagId } from "../../src/silence";
import { adminSilenceStore, silenceCheckHandler, type SilenceStore } from "../../src/silenceFunctions";
import { newPatientDoc, type Flag, type MailDoc, type PatientDoc } from "../../src/types";

const PROJECT_ID = "demo-twoam";
const CLINICIAN = "clinician@example.com";
const HOUR = 60 * 60 * 1000;
const QUIET = "silence-emu-quiet";
const RECENT = "silence-emu-recent";
const NOT_SHARING = "silence-emu-not-sharing";
const NEVER = "silence-emu-never";
const DEMO = "silence-emu-demo";
const LIVE = "silence-emu-live";
const HANDLER_IDS = [QUIET, RECENT, NOT_SHARING, NEVER, DEMO];
const IDS = [...HANDLER_IDS, LIVE];

const adminApp = initializeAdminApp({ projectId: PROJECT_ID }, "silence-admin");
const adminDb = getAdminFirestore(adminApp);
const nowMillis = Date.now();
const quietSince = nowMillis - 25 * HOUR;

/** The Admin SDK store, with the listing narrowed to the given Patients. */
function storeFor(ids: string[]): SilenceStore {
  const base = adminSilenceStore(adminDb);
  return { ...base, listPatients: async () => (await base.listPatients()).filter((p) => ids.includes(p.id)) };
}

const patientRef = (id: string) => adminDb.collection("patients").doc(id);

async function patientDoc(id: string): Promise<PatientDoc> {
  return (await patientRef(id).get()).data() as PatientDoc;
}

async function flagsOf(id: string): Promise<Map<string, Flag>> {
  const snapshot = await patientRef(id).collection("flags").get();
  return new Map(snapshot.docs.map((doc) => [doc.id, doc.data() as Flag]));
}

function live(name: string, overrides: Partial<PatientDoc> = {}): PatientDoc {
  return { ...newPatientDoc(name, CLINICIAN), sharingConsent: "granted", lastSeenAtMillis: quietSince, ...overrides };
}

async function deleteTestPatients() {
  for (const id of IDS) await adminDb.recursiveDelete(patientRef(id));
}

const mailIds: string[] = [];

beforeAll(async () => {
  await deleteTestPatients();
  await patientRef(QUIET).set(live("Quiet Example", { flagLevel: "amber", flagReasons: ["Mood was rated low three times."] }));
  await patientRef(RECENT).set(live("Recent Example", { lastSeenAtMillis: nowMillis - 23 * HOUR }));
  await patientRef(NOT_SHARING).set(live("Private Example", { sharingConsent: "declined" }));
  await patientRef(NEVER).set(live("New Example", { lastSeenAtMillis: null }));
  // A copy of a seeded Demo Patient, quiet for 30 hours: synthetic, so never silent.
  const sparse = generateDemoPatients({ today: dateInZone(nowMillis), nowMillis }).find((p) => p.profile === "sparse")!;
  await writeDemoPatients(adminDb, [{ ...sparse, id: DEMO, patient: { ...sparse.patient, lastSeenAtMillis: nowMillis - 30 * HOUR } }]);
  await patientRef(LIVE).set(live("Live Example", { lastSeenAtMillis: nowMillis - HOUR }));
});

afterAll(async () => {
  await deleteTestPatients();
  await Promise.all(mailIds.map((id) => adminDb.collection("mail").doc(id).delete()));
  await deleteAdminApp(adminApp);
});

describe("silenceCheckHandler with the Admin SDK on the Firestore emulator", () => {
  it("a silent sharing Patient gets one red silent flag, and the record goes red with the reason first", async () => {
    const before = await patientDoc(QUIET);
    const result = await silenceCheckHandler(nowMillis, { store: storeFor(HANDLER_IDS) });
    expect(result).toEqual({ patients: 5, raised: 1, alreadyFlagged: 0, notSilent: 2, notSharing: 1, synthetic: 1, failed: 0 });

    const flags = await flagsOf(QUIET);
    expect([...flags.keys()]).toEqual([silentFlagId(quietSince)]);
    expect(flags.get(silentFlagId(quietSince))).toEqual({
      level: "red",
      kind: "silent",
      reason: SILENT_REASON,
      raisedAtMillis: nowMillis,
      clearedAtMillis: null,
      sharedWithClinician: true,
    });
    // Only the level and reasons change on the record: nothing else, and nothing for the phone.
    expect(await patientDoc(QUIET)).toEqual({ ...before, flagLevel: "red", flagReasons: [SILENT_REASON, "Mood was rated low three times."] });
    mailIds.push(mailIdFor(QUIET, silentFlagId(quietSince)));
  });

  it("a second run adds nothing", async () => {
    const result = await silenceCheckHandler(nowMillis + HOUR, { store: storeFor(HANDLER_IDS) });
    expect(result).toMatchObject({ raised: 0, alreadyFlagged: 1, failed: 0 });
    expect((await flagsOf(QUIET)).size).toBe(1);
    expect((await patientDoc(QUIET)).flagReasons).toEqual([SILENT_REASON, "Mood was rated low three times."]);
  });

  it("a Patient seen 23 hours ago, one not sharing, one never seen and a Demo Patient get nothing", async () => {
    for (const id of [RECENT, NOT_SHARING, NEVER]) {
      expect((await flagsOf(id)).size).toBe(0);
      expect((await patientDoc(id)).flagLevel).toBe("green");
    }
    const demoFlags = [...(await flagsOf(DEMO)).values()];
    expect(demoFlags.some((f) => f.kind === "silent")).toBe(false);
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

async function mailDoc(id: string): Promise<MailDoc | undefined> {
  return (await adminDb.collection("mail").doc(id).get()).data() as MailDoc | undefined;
}

/** Polls until the mail document exists, or gives up after `timeoutMs`. */
async function waitForMail(id: string, timeoutMs = 15_000): Promise<MailDoc | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const mail = await mailDoc(id);
    if (mail) return mail;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return undefined;
}

describe.skipIf(!withFunctions)("the silence test through the Functions emulator", () => {
  it("a live Patient set to 25 hours ago is flagged red on the next run, and redFlagAlert writes exactly one email", async () => {
    // The live Patient was seen an hour ago: the check leaves it alone.
    expect(await silenceCheckHandler(Date.now(), { store: storeFor([LIVE]) })).toMatchObject({ raised: 0, notSilent: 1 });

    const { lastSeenAtMillis } = await startSilenceTest(adminDb, LIVE, Date.now());
    const result = await silenceCheckHandler(Date.now(), { store: storeFor([LIVE]) });
    expect(result).toMatchObject({ raised: 1, failed: 0 });

    const flagId = silentFlagId(lastSeenAtMillis);
    const mailId = mailIdFor(LIVE, flagId);
    mailIds.push(mailId);
    const mail = await waitForMail(mailId);
    expect(mail?.to).toBe(CLINICIAN);
    expect(mail?.message.subject).toBe("[RED] Red flag for Live Example: quiet phone");
    expect(mail?.message.text).toContain(`Reason: ${SILENT_REASON}`);
    expect(mail?.message.text).toContain("A quiet phone is not by itself a sign of self-harm.");
    expect((await patientDoc(LIVE)).flagLevel).toBe("red");

    // The next hourly run raises nothing, so no second email.
    expect(await silenceCheckHandler(Date.now() + HOUR, { store: storeFor([LIVE]) })).toMatchObject({ raised: 0, alreadyFlagged: 1 });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const flags = await flagsOf(LIVE);
    expect([...flags.keys()]).toEqual([flagId]);
    const mails = await Promise.all([...flags.keys()].map((id) => mailDoc(mailIdFor(LIVE, id))));
    expect(mails.filter(Boolean)).toHaveLength(1);
  });
});
