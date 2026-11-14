// Start and Finish Check-in against the emulators.
//
// 1. The handlers with the Admin SDK store against the Firestore emulator, with a fake token client,
//    a fake text model and a fake Decisions client: Start creates the Check-in, Finish writes the
//    Summary, the Check-in's fields, the flags the Decisions answers raise (#20) and the Patient's
//    times and level in one transaction, a retry overwrites and never duplicates a flag, and the
//    Patient then reads the Summary through the security rules (which the Admin SDK writes bypass).
//    The Outcome (#21) lands on the previous accepted Suggestion in the same transaction, with the
//    day's steps from the daily records, once.
// 2. When the Functions emulator is running too, the deployed callables are called through the
//    Firebase JS SDK as the app calls them. Only paths that never reach Gemini are exercised there:
//    refusals, and a finish of a silent Check-in (which calls neither the text model nor the
//    Decisions API). So no request can reach Gemini even with a key in .secret.local. A silent
//    Check-in with the crisis marker raises red crisis there, and the deployed `redFlagAlert`
//    writes the Clinician's email:
//      cd firebase/functions && npm run build && cd ..
//      firebase emulators:exec --only auth,firestore,functions --project demo-twoam "npm --prefix functions run test:emulator"
// 3. Opt-in only, never by default: CHECKIN_REAL_GEMINI=1 with GEMINI_API_KEY in the environment runs
//    the handlers with the REAL token client, text model and Decisions client against the Firestore
//    emulator, with fictional text. Nothing is written to a real project.
import { deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously } from "firebase/auth";
import { connectFirestoreEmulator, doc, getDoc, getFirestore, setDoc, updateDoc } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mailIdFor } from "../../src/alerts";
import { adminCheckInStore, finishCheckInHandler, startCheckInHandler } from "../../src/checkInFunctions";
import { CRISIS_FROM_CHECK_IN_REASON, CRISIS_FROM_REVIEW_REASON, DECLINE_REASON } from "../../src/decisions";
import { fetchDecisionsClient } from "../../src/decisionsApi";
import { genaiTextClient } from "../../src/gemini";
import { MAX_CHECK_IN_STARTS_PER_HOUR, PATIENT_LIMITS } from "../../src/limits";
import { fetchLiveTokenClient } from "../../src/live";
import { REGION } from "../../src/region";
import { outcomeDay } from "../../src/outcomes";
import { newPatientDoc, type PatientDoc, type Summary } from "../../src/types";
import { whatHelps, whatHelpsWindow } from "../../../hosting/js/lib/what-helps.js";
import { FakeDecisions, FakeLiveTokens, FakeTextModel, decisionsReply, decisionsTimeout, verifiedToken } from "../fakes";
import { signInVerified } from "./accounts";

const PROJECT_ID = "demo-twoam";
const HOST = "127.0.0.1";
const CLINICIAN_EMAIL = "clinician@example.com";
const BRIEF = "Fictional Brief for the emulator test: ask Robin about the walk to the library.";
const DRAFT = {
  turns: [
    { speaker: "companion", text: "Hi Robin, did you get to the library?" },
    { speaker: "patient", text: "I did, I walked there on Tuesday and read for an hour. It was calm." },
    { speaker: "patient", text: "Sleep was okay, maybe a three. Mood a four." },
  ],
  voiceCues: [{ label: "calm voice", intensity: 2, heard: "steady pace" }],
  suggestions: [{ kind: "walk", details: "Walk to the library again on Friday", status: "accepted" }],
  crisis: false,
};
const MODEL_JSON = JSON.stringify({
  mood: 4, energy: null, sleepQuality: 3, sleepLine: "Sleep was okay.", themes: ["Library walk", "Calm reading"],
  suggestion: "Library again", previousOutcome: "Walked there on Tuesday and read for an hour.", previousTried: true, previousFelt: null,
  quotes: ["It was calm."],
});

const adminApp = initializeAdminApp({ projectId: PROJECT_ID }, "checkin-admin");
const adminDb = getAdminFirestore(adminApp);
const store = adminCheckInStore(adminDb);

const createdPatients: string[] = [];
async function patient(id: string, overrides: Partial<PatientDoc> = {}) {
  createdPatients.push(id);
  await adminDb.recursiveDelete(adminDb.collection("patients").doc(id));
  await adminDb.collection("patients").doc(id).set({ ...newPatientDoc("Check-in emulator patient", CLINICIAN_EMAIL), sharingConsent: "granted", ...overrides });
}
const docData = async (path: string) => (await adminDb.doc(path).get()).data();
const createdMail: string[] = [];
const count = async (path: string) => (await adminDb.collection(path).get()).size;

afterAll(async () => {
  for (const id of createdPatients) {
    await adminDb.recursiveDelete(adminDb.collection("patients").doc(id));
    await adminDb.collection(PATIENT_LIMITS).doc(id).delete();
  }
  await Promise.all(createdMail.map((id) => adminDb.collection("mail").doc(id).delete()));
  await deleteAdminApp(adminApp);
});

describe("Check-in handlers with the Admin SDK on the Firestore emulator", () => {
  const apps: FirebaseApp[] = [];
  let uid = "";
  let phoneDb: ReturnType<typeof getFirestore>;

  beforeAll(async () => {
    const app = initializeApp({ projectId: PROJECT_ID, apiKey: "demo-api-key" }, "checkin-phone-handlers");
    apps.push(app);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${HOST}:9099`, { disableWarnings: true });
    phoneDb = getFirestore(app);
    connectFirestoreEmulator(phoneDb, HOST, 8080);
    // Anonymous, as before ADR 0010: the record stays the owner's under the rules. The handlers
    // below are called in-process with a verified token for the same uid.
    uid = (await signInAnonymously(auth)).user.uid;
    await patient(uid);
  });

  afterAll(async () => {
    await Promise.all(apps.map((app) => deleteApp(app)));
  });

  it("start creates the Check-in; finish writes the Summary, the Check-in's fields and the Patient's times", async () => {
    const auth = { uid, token: verifiedToken("checkin-phone@example.com") };
    const tokens = new FakeLiveTokens();
    const started = await startCheckInHandler({ data: { patientId: uid, brief: BRIEF, mode: "typed" }, auth }, { store, liveTokens: tokens, clock: () => 1_000 });
    expect(started.token).toBe("auth_tokens/fake-token-1");
    const checkInPath = `patients/${uid}/checkIns/${started.checkInId}`;
    expect(await docData(checkInPath)).toEqual({
      id: started.checkInId, startedAtMillis: 1_000, endedAtMillis: null, mood: null, energy: null, sleepQuality: null,
      voiceCues: [], crisis: false, assessment: null, previousTried: null, sharedWithClinician: true,
    });

    const result = await finishCheckInHandler(
      { data: { patientId: uid, checkInId: started.checkInId, draft: DRAFT, todayLines: ["Steps were usual."] }, auth },
      { store, textModel: new FakeTextModel(MODEL_JSON), decisions: new FakeDecisions(), clock: () => 200_000 },
    );
    const summaryPath = `patients/${uid}/summaries/${started.checkInId}`;
    expect(await docData(summaryPath)).toEqual(result.summary);
    expect(result.summary).toMatchObject({
      checkInId: started.checkInId, createdAtMillis: 200_000, mood: 4, energy: null, sleepQuality: 3, themes: ["Library walk", "Calm reading"],
      voiceCues: DRAFT.voiceCues, suggestion: "Walk to the library again on Friday", quotes: ["It was calm."], sharedWithClinician: true,
    });
    expect(await docData(checkInPath)).toEqual({
      id: started.checkInId, startedAtMillis: 1_000, endedAtMillis: 200_000, mood: 4, energy: null, sleepQuality: 3,
      voiceCues: DRAFT.voiceCues, crisis: false, assessment: "assessed", previousTried: null, sharedWithClinician: true,
    });
    expect(await count(`patients/${uid}/flags`)).toBe(0);
    expect(await docData(`patients/${uid}`)).toMatchObject({ lastCheckInAtMillis: 200_000, lastSeenAtMillis: 200_000 });

    // A retry without usable model output keeps the one Summary, its stamp and creation time.
    await adminDb.doc(`patients/${uid}`).update({ sharingConsent: "declined" });
    await finishCheckInHandler(
      { data: { patientId: uid, checkInId: started.checkInId, draft: DRAFT }, auth },
      { store, textModel: new FakeTextModel("not json"), decisions: new FakeDecisions(), clock: () => 300_000 },
    );
    expect(await count(`patients/${uid}/summaries`)).toBe(1);
    expect(await docData(summaryPath)).toMatchObject({ themes: ["Library walk", "Calm reading"], createdAtMillis: 200_000, sharedWithClinician: true });
    await adminDb.doc(`patients/${uid}`).update({ sharingConsent: "granted" });

    // The Patient reads the Summary through the rules, may still change the Check-in's times, and
    // still may not write a Summary or the ratings.
    const read = (await getDoc(doc(phoneDb, summaryPath))).data() as Summary;
    expect(read.checkInId).toBe(started.checkInId);
    await updateDoc(doc(phoneDb, checkInPath), { endedAtMillis: 250_000 });
    await expect(setDoc(doc(phoneDb, summaryPath), { ...read, themes: ["edited"] })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(updateDoc(doc(phoneDb, checkInPath), { mood: 1 })).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("a refused finish and a never-started Check-in write nothing", async () => {
    await expect(
      finishCheckInHandler(
        { data: { patientId: uid, checkInId: "never-started", draft: DRAFT }, auth: { uid, token: verifiedToken("checkin-phone@example.com") } },
        { store, textModel: new FakeTextModel(MODEL_JSON), decisions: new FakeDecisions() },
      ),
    ).rejects.toMatchObject({ code: "not-found" });
    expect((await adminDb.doc(`patients/${uid}/summaries/never-started`).get()).exists).toBe(false);
    expect((await adminDb.doc(`patients/${uid}/checkIns/never-started`).get()).exists).toBe(false);
  });

  it("Decisions answers raise flags and the level in the finish transaction; a retry adds none; a failure marks the assessment unavailable", async () => {
    const id = `flags-${uid}`;
    await patient(id, { flagLevel: "amber", flagReasons: ["Poor sleep on the last three nights."] });
    const auth = { uid: id, token: verifiedToken("checkin-phone@example.com") };
    const startOne = async () =>
      (await startCheckInHandler({ data: { patientId: id, brief: BRIEF }, auth }, { store, liveTokens: new FakeLiveTokens() })).checkInId;
    const finishOne = (checkInId: string, decisions: FakeDecisions) =>
      finishCheckInHandler({ data: { patientId: id, checkInId, draft: DRAFT }, auth }, { store, textModel: new FakeTextModel(MODEL_JSON), decisions, clock: () => 500_000 });

    const checkInId = await startOne();
    const result = await finishOne(checkInId, new FakeDecisions(decisionsReply({ crisis: 0.93, decline: 0.99 })));
    expect(Object.keys(result).sort()).toEqual(["checkInId", "minimal", "summary"]);
    expect(await docData(`patients/${id}/flags/crisis-${checkInId}`)).toEqual({
      level: "red", kind: "crisis", reason: CRISIS_FROM_REVIEW_REASON, raisedAtMillis: 500_000, clearedAtMillis: null, sharedWithClinician: true,
    });
    expect(await docData(`patients/${id}/flags/decline-${checkInId}`)).toMatchObject({ level: "amber", kind: "decline", reason: DECLINE_REASON });
    expect(await docData(`patients/${id}`)).toMatchObject({
      flagLevel: "red",
      flagReasons: [CRISIS_FROM_REVIEW_REASON, "Poor sleep on the last three nights.", DECLINE_REASON],
    });

    // The phone's reply was lost and it retries: the same two flags, no more.
    await finishOne(checkInId, new FakeDecisions(decisionsReply({ crisis: 0.93, decline: 0.99 })));
    expect(await count(`patients/${id}/flags`)).toBe(2);

    // A later Check-in whose review times out: no flag, the level stays, the Check-in says so.
    const later = await startOne();
    await finishOne(later, decisionsTimeout());
    expect(await count(`patients/${id}/flags`)).toBe(2);
    expect(await docData(`patients/${id}/checkIns/${later}`)).toMatchObject({ assessment: "unavailable", previousTried: null });
    expect(await docData(`patients/${id}`)).toMatchObject({ flagLevel: "red" });
  });

  it("the Outcome lands on the previous accepted Suggestion in the finish transaction, with the day's steps, once", async () => {
    const auth = { uid, token: verifiedToken("checkin-phone@example.com") };
    const DAY = 86_400_000;
    const now = Date.UTC(2026, 10, 14, 17, 0); // 19:00 in Helsinki
    const madeAt = now - DAY;
    const suggestionPath = (id: string) => `patients/${uid}/suggestions/${id}`;
    const open = { kind: "walk", details: "Walk to the library", status: "accepted", booked: false, tried: null, felt: null, objectiveChange: null, outcomeScore: null, outcomeCheckInId: null, sharedWithClinician: true };
    await adminDb.doc(suggestionPath("s-walk")).set({ ...open, id: "s-walk", suggestedAtMillis: madeAt });
    await adminDb.doc(suggestionPath("s-declined")).set({ ...open, id: "s-declined", status: "declined", suggestedAtMillis: madeAt + 60_000 });
    // Five days of 5000 steps before, then 5500 that day with no stored comparison: +2 by the Baseline rule.
    for (let d = 0; d <= 5; d++) {
      const date = outcomeDay(madeAt - d * DAY);
      await adminDb.doc(`patients/${uid}/daily/${date}`).set({
        date, values: { steps: d === 0 ? 5500 : 5000 }, vsBaseline: { steps: null }, composite: null, demoOverride: false, sharedWithClinician: true,
      });
    }
    const started = await startCheckInHandler({ data: { patientId: uid, brief: BRIEF }, auth }, { store, liveTokens: new FakeLiveTokens(), clock: () => now });
    const finishOne = (reply: Record<string, unknown>) =>
      finishCheckInHandler(
        { data: { patientId: uid, checkInId: started.checkInId, draft: DRAFT }, auth },
        { store, textModel: new FakeTextModel(JSON.stringify({ ...JSON.parse(MODEL_JSON), ...reply })), decisions: new FakeDecisions(), clock: () => now + 180_000 },
      );

    await finishOne({ previousTried: true, previousFelt: 4 });
    const recorded = await docData(suggestionPath("s-walk"));
    expect(recorded).toMatchObject({ ...open, id: "s-walk", tried: true, felt: 4, objectiveChange: expect.any(Number), outcomeScore: expect.any(Number), outcomeCheckInId: started.checkInId });
    expect(recorded!.objectiveChange).toBeCloseTo(2, 9);
    expect(recorded!.outcomeScore).toBeCloseTo(0.65, 9);
    expect(await docData(suggestionPath("s-declined"))).toMatchObject({ tried: null, outcomeScore: null, outcomeCheckInId: null });

    // A retry hears it differently, and changes nothing.
    await finishOne({ previousTried: false });
    expect(await docData(suggestionPath("s-walk"))).toEqual(recorded);

    // The dashboard's "what seems to help" reads the new score.
    const suggestions = (await adminDb.collection(`patients/${uid}/suggestions`).get()).docs.map((d) => d.data());
    const helps = whatHelps(suggestions, { ...whatHelpsWindow(outcomeDay(now)), timeZone: "Europe/Helsinki" });
    expect(helps.rows.map((r) => [r.kind, r.n, r.feelings.better])).toEqual([["walk", 1, 1]]);

    // The phone reads the Outcome but cannot change it.
    expect((await getDoc(doc(phoneDb, suggestionPath("s-walk")))).data()).toMatchObject({ tried: true, felt: 4 });
    for (const field of [{ outcomeScore: 1 }, { tried: false }, { outcomeCheckInId: null }]) {
      await expect(updateDoc(doc(phoneDb, suggestionPath("s-walk")), field)).rejects.toMatchObject({ code: "permission-denied" });
    }
  });

  it("the store records each start, refuses the one past the hourly cap, and no client reads the record", async () => {
    const id = `cap-${uid}`;
    createdPatients.push(id);
    const start = (n: number) => store.reserveStart(id, { checkInId: `c${n}`, uid, startedAtMillis: 1_000 + n });
    for (let i = 0; i < MAX_CHECK_IN_STARTS_PER_HOUR; i++) expect(await start(i)).toBe(true);
    expect(await start(MAX_CHECK_IN_STARTS_PER_HOUR)).toBe(false);
    expect(await store.getStart(id, "c3")).toEqual({ checkInId: "c3", uid, startedAtMillis: 1_003 });
    expect(await store.getStart(id, `c${MAX_CHECK_IN_STARTS_PER_HOUR}`)).toBeUndefined();
    await expect(getDoc(doc(phoneDb, `${PATIENT_LIMITS}/${uid}`))).rejects.toMatchObject({ code: "permission-denied" });
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

describe.skipIf(!withFunctions)("Check-in callables through the Functions emulator", () => {
  const apps: FirebaseApp[] = [];

  function client(name: string) {
    const app = initializeApp({ projectId: PROJECT_ID, apiKey: "demo-api-key" }, name);
    apps.push(app);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${HOST}:9099`, { disableWarnings: true });
    const functions = getFunctions(app, REGION);
    connectFunctionsEmulator(functions, HOST, 5001);
    return { auth, start: httpsCallable(functions, "startCheckIn"), finish: httpsCallable(functions, "finishCheckIn") };
  }

  let phone: ReturnType<typeof client>;
  let other: ReturnType<typeof client>;
  let signedOut: ReturnType<typeof client>;
  let anonymous: ReturnType<typeof client>;
  let uid = "";
  let anonymousUid = "";
  const checkInId = "emulator-silent-checkin";

  beforeAll(async () => {
    phone = client("checkin-phone");
    other = client("checkin-other");
    signedOut = client("checkin-signed-out");
    anonymous = client("checkin-anonymous");
    uid = (await signInVerified(adminApp, phone.auth, { email: "checkin-phone@example.com", password: "demo-password-3" })).uid;
    await signInVerified(adminApp, other.auth, { email: "checkin-other@example.com", password: "demo-password-4" });
    await patient(uid, { lastSeenAtMillis: null, lastCheckInAtMillis: null });
    // A Patient who signed in anonymously before ADR 0010 and still has their record.
    anonymousUid = (await signInAnonymously(anonymous.auth)).user.uid;
    await patient(anonymousUid);
    // The Check-in as Start Check-in creates it (minting a real token is not exercised here).
    await startCheckInHandler(
      { data: { patientId: uid, brief: BRIEF }, auth: { uid, token: verifiedToken("checkin-phone@example.com") } },
      { store, liveTokens: new FakeLiveTokens(), newId: () => checkInId },
    );
  });

  it("an anonymous Patient is told to verify their account, and nothing is started or finished", async () => {
    const refusal = (call: Promise<unknown>) => call.then(() => null, (e: { code: string; message: string }) => ({ code: e.code, message: e.message }));
    // The SDK adds the HTTP status to the message.
    const verify = { code: "functions/failed-precondition", message: expect.stringContaining("Verify your account to continue.") };
    expect(await refusal(anonymous.start({ patientId: anonymousUid, brief: BRIEF }))).toEqual(verify);
    expect(await refusal(anonymous.finish({ patientId: anonymousUid, checkInId: "any", draft: { turns: [] } }))).toEqual(verify);
    expect(await refusal(anonymous.start({ patientId: uid, brief: BRIEF }))).toEqual(verify);
    expect(await count(`patients/${anonymousUid}/checkIns`)).toBe(0);
    expect(await count(`patients/${anonymousUid}/summaries`)).toBe(0);
  });

  afterAll(async () => {
    await Promise.all(apps.map((app) => deleteApp(app)));
  });

  it("start refuses a signed-out caller, another user and an empty Brief, and creates nothing", async () => {
    await expect(signedOut.start({ patientId: uid, brief: BRIEF })).rejects.toMatchObject({ code: "functions/unauthenticated" });
    await expect(other.start({ patientId: uid, brief: BRIEF })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(phone.start({ patientId: uid, brief: "   " })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(phone.start({ patientId: uid, brief: BRIEF, mode: "video" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    expect(await count(`patients/${uid}/checkIns`)).toBe(1);
  });

  it("finish of a silent Check-in writes the minimal Summary, without the model; a retry never duplicates it", async () => {
    const draft = { turns: [{ speaker: "companion", text: "Hi, are you there?" }], voiceCues: [], suggestions: [], crisis: false };
    const first = (await phone.finish({ patientId: uid, checkInId, draft })).data as { summary: Summary; minimal: boolean };
    expect(first.minimal).toBe(true);
    expect(first.summary).toMatchObject({ checkInId, themes: [], quotes: [], mood: null, sharedWithClinician: true });
    await phone.finish({ patientId: uid, checkInId, draft });
    expect(await count(`patients/${uid}/summaries`)).toBe(1);
    expect(await docData(`patients/${uid}/summaries/${checkInId}`)).toEqual(first.summary);
    const record = await docData(`patients/${uid}`);
    expect(record?.lastCheckInAtMillis).toEqual(expect.any(Number));
    expect(record?.lastSeenAtMillis).toEqual(expect.any(Number));
  });

  it("a silent Check-in with the crisis marker raises red crisis, and redFlagAlert emails the Clinician once", async () => {
    const crisisCheckInId = "emulator-silent-crisis";
    await startCheckInHandler({ data: { patientId: uid, brief: BRIEF }, auth: { uid, token: verifiedToken("checkin-phone@example.com") } }, { store, liveTokens: new FakeLiveTokens(), newId: () => crisisCheckInId });
    const draft = { turns: [{ speaker: "companion", text: "Hi, are you there?" }], voiceCues: [], suggestions: [], crisis: true };
    const response = (await phone.finish({ patientId: uid, checkInId: crisisCheckInId, draft })).data as Record<string, unknown>;
    // The phone hears nothing of the flag.
    expect(Object.keys(response).sort()).toEqual(["checkInId", "minimal", "summary"]);
    const flagId = `crisis-${crisisCheckInId}`;
    expect(await docData(`patients/${uid}/flags/${flagId}`)).toMatchObject({ level: "red", kind: "crisis", reason: CRISIS_FROM_CHECK_IN_REASON, sharedWithClinician: true });
    expect(await docData(`patients/${uid}`)).toMatchObject({ flagLevel: "red" });
    expect(await docData(`patients/${uid}/checkIns/${crisisCheckInId}`)).toMatchObject({ crisis: true, assessment: null });

    const mailId = mailIdFor(uid, flagId);
    createdMail.push(mailId);
    const deadline = Date.now() + 15_000;
    let mail: Record<string, unknown> | undefined;
    while (!mail && Date.now() < deadline) {
      mail = await docData(`mail/${mailId}`);
      if (!mail) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(mail).toMatchObject({ to: CLINICIAN_EMAIL, message: { subject: "[CRISIS] Red flag for Check-in emulator patient: crisis in a Check-in" } });
    expect((mail as { message: { text: string } }).message.text).toContain(CRISIS_FROM_CHECK_IN_REASON);

    // A retry raises no second flag, so no second email.
    await phone.finish({ patientId: uid, checkInId: crisisCheckInId, draft });
    expect((await adminDb.collection(`patients/${uid}/flags`).get()).docs.map((d) => d.id)).toEqual([flagId]);
  });

  it("finish refuses another user, a signed-out caller and a Check-in that was never started", async () => {
    const draft = { turns: [] };
    await expect(other.finish({ patientId: uid, checkInId, draft })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(signedOut.finish({ patientId: uid, checkInId, draft })).rejects.toMatchObject({ code: "functions/unauthenticated" });
    await expect(phone.finish({ patientId: uid, checkInId: "nope", draft })).rejects.toMatchObject({ code: "functions/not-found" });
    await expect(phone.finish({ patientId: uid, checkInId, draft: "transcript" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
  });
});

const realGemini = process.env.CHECKIN_REAL_GEMINI === "1" && !!process.env.GEMINI_API_KEY;

describe.skipIf(!realGemini)("OPT-IN: the handlers with the real Gemini API, Firestore emulator only", () => {
  it("mints a real Live token, makes a real Summary and a real review from fictional text", { timeout: 60_000 }, async () => {
    const key = process.env.GEMINI_API_KEY!;
    const id = "checkin-real-gemini-patient";
    await patient(id);
    const auth = { uid: id, token: verifiedToken("checkin-real-gemini@example.com") };
    const started = await startCheckInHandler({ data: { patientId: id, brief: BRIEF, mode: "typed" }, auth }, { store, liveTokens: fetchLiveTokenClient(key) });
    expect(started.token).toMatch(/^auth_tokens\//);
    const result = await finishCheckInHandler(
      { data: { patientId: id, checkInId: started.checkInId, draft: DRAFT }, auth },
      { store, textModel: genaiTextClient(key), decisions: fetchDecisionsClient(key) },
    );
    expect(result.minimal).toBe(false);
    // The fictional Check-in is routine: reviewed, nothing raised.
    expect(await docData(`patients/${id}/checkIns/${started.checkInId}`)).toMatchObject({ assessment: "assessed" });
    expect(await count(`patients/${id}/flags`)).toBe(0);
    expect(result.summary.themes.length).toBeGreaterThan(0);
    expect(result.summary.voiceCues).toEqual(DRAFT.voiceCues);
  });
});
