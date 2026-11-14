// The Start and Finish Check-in handlers with fake stores, a fake token client and a fake text model:
// caller rules, what is written where, stamps, retries, and the fallbacks.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { finishCheckInHandler, startCheckInHandler } from "../src/checkInFunctions";
import type { CallerAuth } from "../src/clinician";
import { LIVE_ENDPOINT, LIVE_NEW_SESSION_WINDOW_MS, LIVE_TOKEN_LIFETIME_MS } from "../src/live";
import { newPatientDoc, type PatientDoc } from "../src/types";
import { CLINICIAN_EMAIL, FakeCheckInStore, FakeLiveTokens, FakeTextModel, PATIENT_ID, failingTextModel } from "./fakes";

const SPIKE = join(__dirname, "..", "..", "..", "fixtures", "spike", "interactions");
const recorded = JSON.parse(readFileSync(join(SPIKE, "finish-checkin-structured-v1.json"), "utf8"));
const MODEL_JSON: string = recorded.response.body.steps.find((s: { type: string }) => s.type === "model_output").content[0].text;

const NOW = 1_763_000_000_000;
const DEMO_ID = "demo-steady";
/** A verified email and password account (ADR 0010); the claim makes it a Clinician's. */
const verifiedToken = (email: string): CallerAuth["token"] => ({ email, email_verified: true, firebase: { sign_in_provider: "password" } });
const clinicianToken = (email: string): CallerAuth["token"] => ({ ...verifiedToken(email), role: "clinician" });
const patientAuth: CallerAuth = { uid: PATIENT_ID, token: verifiedToken("patient-1@example.com") };
const otherAuth: CallerAuth = { uid: "someone-else", token: verifiedToken("someone-else@example.com") };
const clinicianAuth: CallerAuth = { uid: "clinician-uid", token: clinicianToken(CLINICIAN_EMAIL) };
const BRIEF = "Fictional Brief for Alex: ask about the harbour walk, then the three ratings.";

const DRAFT = {
  turns: [
    { speaker: "companion", text: "Hi Alex. Did you try the walk by the harbour?" },
    { speaker: "patient", text: "Yeah, I went on Saturday. Only twenty minutes, but it was nice to see the water. I felt a bit lighter after." },
    { speaker: "patient", text: "Not great. I woke up around four and couldn't get back to sleep." },
    { speaker: "patient", text: "Work has been a lot this week, lots of deadlines." },
    { speaker: "patient", text: "Mood maybe a three. Energy a two. Sleep a two as well." },
  ],
  voiceCues: [{ label: "tired voice", intensity: 3, heard: "slow, quiet answers" }],
  suggestions: [],
  crisis: false,
};

let store: FakeCheckInStore;
let tokens: FakeLiveTokens;
let ids: number;

function patients(): Record<string, Partial<PatientDoc>> {
  return {
    [PATIENT_ID]: { ...newPatientDoc("Live patient", CLINICIAN_EMAIL), sharingConsent: "granted" },
    [DEMO_ID]: { ...newPatientDoc("Demo", CLINICIAN_EMAIL), synthetic: true, sharingConsent: "granted", lastCheckInAtMillis: NOW - 86_400_000 },
  };
}

beforeEach(() => {
  store = new FakeCheckInStore(patients());
  tokens = new FakeLiveTokens();
  ids = 0;
});

const startDeps = () => ({ store, liveTokens: tokens, clock: () => NOW, newId: () => `checkin-${++ids}` });
/** Stands for a signed-out caller (a default parameter would replace `undefined`). */
const SIGNED_OUT = "signed-out" as const;
type Caller = CallerAuth | typeof SIGNED_OUT;
const authOf = (caller: Caller) => (caller === SIGNED_OUT ? undefined : caller);
const start = (data: unknown, caller: Caller = patientAuth) => startCheckInHandler({ data, auth: authOf(caller) }, startDeps());
const finish = (data: unknown, textModel = new FakeTextModel(MODEL_JSON), caller: Caller = patientAuth, clock = () => NOW + 180_000) =>
  finishCheckInHandler({ data, auth: authOf(caller) }, { store, textModel, clock });

async function started(patientId = PATIENT_ID, auth: CallerAuth = patientAuth) {
  return (await start({ patientId, brief: BRIEF }, auth)).checkInId;
}

describe("startCheckIn", () => {
  it("mints a token and creates the Check-in with empty function-only fields, stamped", async () => {
    const result = await start({ patientId: PATIENT_ID, brief: BRIEF, mode: "typed" });
    expect(result).toEqual({
      checkInId: "checkin-1",
      token: "auth_tokens/fake-token-1",
      model: "models/gemini-3.8-live",
      endpoint: LIVE_ENDPOINT,
      mode: "typed",
      connectByMillis: NOW + LIVE_NEW_SESSION_WINDOW_MS,
      expiresAtMillis: NOW + LIVE_TOKEN_LIFETIME_MS,
    });
    expect(store.checkIns.get(`${PATIENT_ID}/checkin-1`)).toEqual({
      id: "checkin-1",
      startedAtMillis: NOW,
      endedAtMillis: null,
      mood: null,
      energy: null,
      sleepQuality: null,
      voiceCues: [],
      crisis: false,
      sharedWithClinician: true,
    });
  });

  it("stamps the Check-in false while the Patient is not sharing", async () => {
    store.patients.set(PATIENT_ID, { ...store.patients.get(PATIENT_ID)!, sharingConsent: "declined" });
    const { checkInId } = await start({ patientId: PATIENT_ID, brief: BRIEF });
    expect(store.checkIns.get(`${PATIENT_ID}/${checkInId}`)?.sharedWithClinician).toBe(false);
  });

  it("locks the Brief and the safety rules into the token; the AI disclosure only at the first Check-in", async () => {
    await start({ patientId: PATIENT_ID, brief: BRIEF });
    const first = tokens.requests[0]!.bidiGenerateContentSetup.systemInstruction.parts[0].text;
    expect(first.startsWith(BRIEF)).toBe(true);
    expect(first).toContain("do not counsel");
    expect(first).toContain("first Check-in");
    expect(tokens.requests[0]!.uses).toBe(1);
    expect(tokens.requests[0]!.fieldMask.split(",")).toContain("model");

    await start({ patientId: DEMO_ID, brief: BRIEF });
    expect(tokens.requests[1]!.bidiGenerateContentSetup.systemInstruction.parts[0].text).not.toContain("first Check-in");
  });

  it("refuses a signed-out caller and another user, before minting or writing", async () => {
    await expect(start({ patientId: PATIENT_ID, brief: BRIEF }, SIGNED_OUT)).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(start({ patientId: PATIENT_ID, brief: BRIEF }, otherAuth)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(start({ patientId: PATIENT_ID, brief: BRIEF }, clinicianAuth)).rejects.toMatchObject({ code: "permission-denied" });
    expect(tokens.requests).toHaveLength(0);
    expect(store.writes).toHaveLength(0);
  });

  it("refuses a missing Patient with the same answer as another user's", async () => {
    const missing = await start({ patientId: "no-such-patient", brief: BRIEF }, { uid: "no-such-patient", token: verifiedToken("nobody@example.com") }).catch((e: unknown) => e);
    const other = await start({ patientId: PATIENT_ID, brief: BRIEF }, otherAuth).catch((e: unknown) => e);
    expect(missing).toMatchObject({ code: "permission-denied" });
    expect((missing as Error).message).toBe((other as Error).message);
  });

  it("lets anyone signed in start a Check-in for a Demo Patient (the demo shortcut)", async () => {
    const result = await start({ patientId: DEMO_ID, brief: BRIEF }, otherAuth);
    expect(store.checkIns.has(`${DEMO_ID}/${result.checkInId}`)).toBe(true);
  });

  it("refuses an empty Brief before reading or minting", async () => {
    store.failReads = true;
    await expect(start({ patientId: PATIENT_ID, brief: "  " })).rejects.toMatchObject({ code: "invalid-argument" });
    expect(tokens.requests).toHaveLength(0);
  });

  it("creates no Check-in when the token request fails", async () => {
    tokens.fail = 503;
    await expect(start({ patientId: PATIENT_ID, brief: BRIEF })).rejects.toMatchObject({ code: "unavailable" });
    expect(store.writes).toHaveLength(0);
  });

  it("answers unavailable when the store fails", async () => {
    store.failWrites = true;
    await expect(start({ patientId: PATIENT_ID, brief: BRIEF })).rejects.toMatchObject({ code: "unavailable" });
    store.failWrites = false;
    store.failReads = true;
    await expect(start({ patientId: PATIENT_ID, brief: BRIEF })).rejects.toMatchObject({ code: "unavailable" });
  });

  it("gives every Check-in its own id", async () => {
    const a = await started();
    const b = await started();
    expect(a).not.toBe(b);
  });
});

describe("finishCheckIn", () => {
  it("writes the Summary, the ratings and Voice cues on the Check-in, and the Patient's times", async () => {
    const checkInId = await started();
    const result = await finish({ patientId: PATIENT_ID, checkInId, draft: DRAFT, todayLines: ["Sleep was shorter than usual."] });

    expect(result.minimal).toBe(false);
    expect(result.summary).toEqual({
      checkInId,
      createdAtMillis: NOW + 180_000,
      mood: 3,
      energy: 2,
      sleepQuality: 2,
      sleepLine: "Woke up around four and couldn't get back to sleep.",
      themes: ["Harbour walk", "Early waking", "Low energy", "Work deadlines"],
      voiceCues: DRAFT.voiceCues,
      suggestion: "Ten-minute stretch break around three this afternoon",
      previousOutcome: "Went for twenty minutes on Saturday, liked seeing the water, and felt a bit lighter after.",
      quotes: ["I felt a bit lighter after.", "I woke up around four and couldn't get back to sleep.", "Work has been a lot this week, lots of deadlines."],
      sharedWithClinician: true,
    });
    expect(store.summaries.get(`${PATIENT_ID}/${checkInId}`)).toEqual(result.summary);
    expect(store.checkIns.get(`${PATIENT_ID}/${checkInId}`)).toMatchObject({
      startedAtMillis: NOW,
      endedAtMillis: NOW + 180_000,
      mood: 3,
      energy: 2,
      sleepQuality: 2,
      voiceCues: DRAFT.voiceCues,
      crisis: false,
      sharedWithClinician: true,
    });
    expect(store.patients.get(PATIENT_ID)).toMatchObject({ lastCheckInAtMillis: NOW + 180_000, lastSeenAtMillis: NOW + 180_000 });
  });

  it("sends the model the transcript with storage off and structured output", async () => {
    const checkInId = await started();
    const model = new FakeTextModel(MODEL_JSON);
    store.suggestions.set(`${PATIENT_ID}/s-walk`, { details: "A short walk by the harbour" });
    await finish({ patientId: PATIENT_ID, checkInId, draft: DRAFT, lastSuggestionId: "s-walk" }, model);
    expect(model.requests).toHaveLength(1);
    expect(model.requests[0]!.store).toBe(false);
    expect(model.requests[0]!.response_format?.mime_type).toBe("application/json");
    expect(model.requests[0]!.input).toContain("Patient: Work has been a lot this week");
    expect(model.requests[0]!.input).toContain("previous Suggestion the companion asked about: A short walk by the harbour");
  });

  it("writes nothing but the Summary, the Check-in and the Patient record: never the transcript", async () => {
    const checkInId = await started();
    store.writes.length = 0;
    await finish({ patientId: PATIENT_ID, checkInId, draft: DRAFT });
    expect(store.writes.map((w) => w.path)).toEqual([`patients/${PATIENT_ID}/summaries/${checkInId}`, `patients/${PATIENT_ID}/checkIns/${checkInId}`, `patients/${PATIENT_ID}`]);
    const written = JSON.stringify(store.writes);
    expect(written).not.toContain("Mood maybe a three");
    expect(written).not.toContain("Did you try the walk");
    expect(written).not.toContain("turns");
  });

  it("a retry overwrites the same Summary and never creates a second one; the stamp is kept", async () => {
    const checkInId = await started();
    await finish({ patientId: PATIENT_ID, checkInId, draft: DRAFT });
    // The Patient stops sharing between the two attempts: the Summary keeps its first stamp.
    store.patients.set(PATIENT_ID, { ...store.patients.get(PATIENT_ID)!, sharingConsent: "declined" });
    const retry = await finish({ patientId: PATIENT_ID, checkInId, draft: DRAFT }, new FakeTextModel(JSON.stringify({ themes: ["Second try"] })), patientAuth, () => NOW + 240_000);
    expect([...store.summaries.keys()]).toEqual([`${PATIENT_ID}/${checkInId}`]);
    expect(retry.summary.themes).toEqual(["Second try"]);
    expect(retry.summary.sharedWithClinician).toBe(true);
    expect(retry.summary.createdAtMillis).toBe(NOW + 180_000);
    expect(store.checkIns.get(`${PATIENT_ID}/${checkInId}`)?.endedAtMillis).toBe(NOW + 180_000);
  });

  it("stamps the Summary false when the Patient is not sharing", async () => {
    store.patients.set(PATIENT_ID, { ...store.patients.get(PATIENT_ID)!, sharingConsent: "undecided" });
    const checkInId = await started();
    const { summary } = await finish({ patientId: PATIENT_ID, checkInId, draft: DRAFT });
    expect(summary.sharedWithClinician).toBe(false);
  });

  it("falls back to a minimal Summary when the model fails or replies with malformed output, and still succeeds", async () => {
    for (const textModel of [failingTextModel(500), new FakeTextModel("not json at all"), new FakeTextModel(null), new FakeTextModel("[]")]) {
      const checkInId = await started();
      const result = await finish({ patientId: PATIENT_ID, checkInId, draft: DRAFT }, textModel);
      expect(result.minimal).toBe(true);
      expect(result.summary).toMatchObject({ themes: [], quotes: [], sleepLine: "", mood: null, energy: null, sleepQuality: null, voiceCues: DRAFT.voiceCues });
      expect(store.summaries.has(`${PATIENT_ID}/${checkInId}`)).toBe(true);
    }
  });

  it("a silent Check-in still yields a Summary, without calling the model", async () => {
    const checkInId = await started();
    const model = new FakeTextModel(MODEL_JSON);
    const result = await finish({ patientId: PATIENT_ID, checkInId, draft: { turns: [{ speaker: "companion", text: "Hi, how are you?" }] } }, model);
    expect(model.requests).toHaveLength(0);
    expect(result.minimal).toBe(true);
    expect(result.summary.themes).toEqual([]);
    expect(store.patients.get(PATIENT_ID)?.lastCheckInAtMillis).toBe(NOW + 180_000);
  });

  it("a very short Check-in still yields a Summary", async () => {
    const checkInId = await started();
    const result = await finish({ patientId: PATIENT_ID, checkInId, draft: { turns: [{ speaker: "patient", text: "Fine." }] } }, new FakeTextModel(JSON.stringify({ themes: ["Brief check-in"], quotes: ["Fine."] })));
    expect(result.summary.themes).toEqual(["Brief check-in"]);
    expect(result.summary.quotes).toEqual(["Fine."]);
  });

  it("keeps ratings out of range as null and caps quotes at three of at most 200 characters", async () => {
    const long = `I kept walking ${"and walking ".repeat(30)}until noon`;
    const draft = { ...DRAFT, turns: [...DRAFT.turns, { speaker: "patient", text: long }] };
    const reply = { mood: 9, energy: 0, sleepQuality: 3, quotes: [long, "I felt a bit lighter after.", "Work has been a lot this week, lots of deadlines.", "Mood maybe a three."] };
    const checkInId = await started();
    const { summary } = await finish({ patientId: PATIENT_ID, checkInId, draft }, new FakeTextModel(JSON.stringify(reply)));
    expect([summary.mood, summary.energy, summary.sleepQuality]).toEqual([null, null, 3]);
    expect(summary.quotes).toHaveLength(3);
    for (const quote of summary.quotes) expect(quote.length).toBeLessThanOrEqual(200);
  });

  it("takes Voice cues from the draft even when the model invents some", async () => {
    const checkInId = await started();
    const reply = JSON.parse(MODEL_JSON);
    reply.voiceCues = [{ label: "invented", intensity: 5, heard: "nothing" }];
    const { summary } = await finish({ patientId: PATIENT_ID, checkInId, draft: DRAFT }, new FakeTextModel(JSON.stringify(reply)));
    expect(summary.voiceCues).toEqual(DRAFT.voiceCues);
    expect(store.checkIns.get(`${PATIENT_ID}/${checkInId}`)?.voiceCues).toEqual(DRAFT.voiceCues);
  });

  it("leaves ratings and Voice cues out when the Patient has left them out", async () => {
    store.consents.set(`${PATIENT_ID}/ratings`, false);
    store.consents.set(`${PATIENT_ID}/voice_cues`, false);
    const checkInId = await started();
    const { summary } = await finish({ patientId: PATIENT_ID, checkInId, draft: DRAFT });
    expect([summary.mood, summary.energy, summary.sleepQuality, summary.voiceCues]).toEqual([null, null, null, []]);
    expect(store.checkIns.get(`${PATIENT_ID}/${checkInId}`)).toMatchObject({ mood: null, voiceCues: [] });
  });

  it("records the draft's crisis marker on the Check-in", async () => {
    const checkInId = await started();
    await finish({ patientId: PATIENT_ID, checkInId, draft: { ...DRAFT, crisis: true } });
    expect(store.checkIns.get(`${PATIENT_ID}/${checkInId}`)?.crisis).toBe(true);
  });

  it("refuses a signed-out caller and another user, and writes nothing", async () => {
    const checkInId = await started();
    store.writes.length = 0;
    const model = new FakeTextModel(MODEL_JSON);
    await expect(finish({ patientId: PATIENT_ID, checkInId, draft: DRAFT }, model, SIGNED_OUT)).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(finish({ patientId: PATIENT_ID, checkInId, draft: DRAFT }, model, otherAuth)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(finish({ patientId: PATIENT_ID, checkInId, draft: DRAFT }, model, clinicianAuth)).rejects.toMatchObject({ code: "permission-denied" });
    expect(model.requests).toHaveLength(0);
    expect(store.writes).toHaveLength(0);
  });

  it("lets anyone signed in finish a Demo Patient's Check-in (the demo shortcut)", async () => {
    const checkInId = await started(DEMO_ID, otherAuth);
    const { summary } = await finish({ patientId: DEMO_ID, checkInId, draft: DRAFT }, new FakeTextModel(MODEL_JSON), otherAuth);
    expect(store.summaries.get(`${DEMO_ID}/${checkInId}`)).toEqual(summary);
  });

  it("refuses a Check-in that was never started, before calling the model", async () => {
    const model = new FakeTextModel(MODEL_JSON);
    await expect(finish({ patientId: PATIENT_ID, checkInId: "never-started", draft: DRAFT }, model)).rejects.toMatchObject({ code: "not-found" });
    expect(model.requests).toHaveLength(0);
    expect(store.summaries.size).toBe(0);
  });

  it("answers unavailable when the write fails, so the phone can retry with the same id", async () => {
    const checkInId = await started();
    store.failWrites = true;
    await expect(finish({ patientId: PATIENT_ID, checkInId, draft: DRAFT })).rejects.toMatchObject({ code: "unavailable" });
    expect(store.summaries.size).toBe(0);
    store.failWrites = false;
    await finish({ patientId: PATIENT_ID, checkInId, draft: DRAFT });
    expect(store.summaries.size).toBe(1);
  });

  it("refuses an invalid request before reading anything", async () => {
    store.failReads = true;
    await expect(finish({ patientId: PATIENT_ID, checkInId: "", draft: DRAFT })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(finish({ patientId: PATIENT_ID, checkInId: "c", draft: "transcript" })).rejects.toMatchObject({ code: "invalid-argument" });
  });
});
