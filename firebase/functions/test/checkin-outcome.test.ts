// Finish Check-in's Outcome (#21) with fake stores: which Suggestion it lands on, which answer counts,
// the day's steps, the score, and retries.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { finishCheckInHandler, startCheckInHandler } from "../src/checkInFunctions";
import type { CallerAuth } from "../src/clinician";
import { NOT_TRIED_SCORE, outcomeDay } from "../src/outcomes";
import { newPatientDoc, type Suggestion } from "../src/types";
import { whatHelps, whatHelpsWindow } from "../../hosting/js/lib/what-helps.js";
import { CLINICIAN_EMAIL, FakeCheckInStore, FakeDecisions, FakeLiveTokens, FakeTextModel, PATIENT_ID, decisionsReply, decisionsTimeout, failingTextModel } from "./fakes";

const SPIKE = join(__dirname, "..", "..", "..", "fixtures", "spike", "interactions");
const recorded = JSON.parse(readFileSync(join(SPIKE, "finish-checkin-structured-v1.json"), "utf8"));
/** The recorded reply: `previousTried: true`, `previousFelt: null`. */
const MODEL = JSON.parse(recorded.response.body.steps.find((s: { type: string }) => s.type === "model_output").content[0].text);
const reply = (overrides: Record<string, unknown> = {}) => new FakeTextModel(JSON.stringify({ ...MODEL, ...overrides }));

const NOW = 1_763_000_000_000;
const DAY = 86_400_000;
const auth: CallerAuth = { uid: PATIENT_ID, token: {} };
const DRAFT = {
  turns: [
    { speaker: "companion", text: "Hi Alex. Did you try the walk by the harbour?" },
    { speaker: "patient", text: "Yeah, I went on Saturday. I felt a bit lighter after." },
    { speaker: "patient", text: "Mood maybe a three. Energy a two. Sleep a two as well." },
  ],
  voiceCues: [],
  suggestions: [],
  crisis: false,
};

let store: FakeCheckInStore;
let decisions: FakeDecisions;
let clock: number;
let ids: number;

beforeEach(() => {
  store = new FakeCheckInStore({ [PATIENT_ID]: { ...newPatientDoc("Live patient", CLINICIAN_EMAIL), sharingConsent: "granted" } });
  // Decisions unsure about "tried" unless a test says otherwise, so the text model's answer shows.
  decisions = new FakeDecisions(decisionsReply({ crisis: 0.02, decline: 0.05, triedLast: 0.5 }));
  clock = NOW;
  ids = 0;
});

async function started(): Promise<string> {
  const result = await startCheckInHandler(
    { data: { patientId: PATIENT_ID, brief: "Fictional Brief." }, auth },
    { store, liveTokens: new FakeLiveTokens(), clock: () => clock, newId: () => `checkin-${++ids}` },
  );
  return result.checkInId;
}

const finish = (data: Record<string, unknown>, textModel: FakeTextModel = reply()) =>
  finishCheckInHandler({ data: { patientId: PATIENT_ID, draft: DRAFT, ...data }, auth }, { store, textModel, decisions, clock: () => clock + 180_000 });

function suggest(id: string, at: number, s: Partial<Suggestion> = {}) {
  store.suggestions.set(`${PATIENT_ID}/${id}`, {
    id, kind: "walk", details: `Details of ${id}`, suggestedAtMillis: at, status: "accepted", booked: false,
    tried: null, felt: null, objectiveChange: null, outcomeScore: null, outcomeCheckInId: null, sharedWithClinician: true, ...s,
  });
}
const suggestion = (id: string) => store.suggestions.get(`${PATIENT_ID}/${id}`)!;
/** A daily record of the day a Suggestion was made, with a stored steps comparison. */
const dailyFor = (at: number, vsSteps: number | null, steps: number | null = 8000) =>
  store.daily.set(`${PATIENT_ID}/${outcomeDay(at)}`, { date: outcomeDay(at), values: { steps }, vsBaseline: { steps: vsSteps }, sharedWithClinician: true });
const suggestionWrites = () => store.writes.filter((w) => w.path.includes("/suggestions/"));

describe("finishCheckIn: the Outcome (#21)", () => {
  it("lands on the most recent accepted Suggestion without one, with the day's steps and the score; nothing else on it changes", async () => {
    suggest("s-older", NOW - 3 * DAY);
    suggest("s-walk", NOW - DAY, { sharedWithClinician: false, booked: true });
    dailyFor(NOW - DAY, 0.5);
    const checkInId = await started();
    await finish({ checkInId, lastSuggestionId: "s-walk" });

    expect(suggestion("s-walk")).toEqual({
      id: "s-walk", kind: "walk", details: "Details of s-walk", suggestedAtMillis: NOW - DAY, status: "accepted", booked: true,
      tried: true, felt: null, objectiveChange: 0.5, outcomeScore: 0.3 * 0.5, outcomeCheckInId: checkInId,
      // The stamp is the Suggestion's own; an Outcome filled in later never changes it.
      sharedWithClinician: false,
    });
    expect(suggestion("s-older").outcomeCheckInId).toBeNull();
    expect(suggestionWrites().map((w) => Object.keys(w.data as object).sort())).toEqual([["felt", "objectiveChange", "outcomeCheckInId", "outcomeScore", "tried"]]);
  });

  it("finds the target itself when the phone names none, and tells both models about it", async () => {
    suggest("s-walk", NOW - DAY);
    decisions = new FakeDecisions(decisionsReply({ crisis: 0.02, decline: 0.05, triedLast: 0.5 }));
    const textModel = reply({ previousFelt: 4 });
    const checkInId = await started();
    await finish({ checkInId }, textModel);
    expect(textModel.requests[0]!.input).toContain("Details of s-walk");
    expect(decisions.requests[0]!.questions.triedLast).toBeDefined();
    // No daily record for that day: the step change is missing and adds nothing.
    expect(suggestion("s-walk")).toMatchObject({ tried: true, felt: 4, objectiveChange: null, outcomeScore: 0.35, outcomeCheckInId: checkInId });
  });

  it("takes the text model's answer over the Decisions answer, and the Decisions answer only when the model is unsure", async () => {
    suggest("s-1", NOW - DAY);
    decisions = new FakeDecisions(decisionsReply({ crisis: 0.02, decline: 0.05, triedLast: 0.95 }));
    const first = await started();
    await finish({ checkInId: first }, reply({ previousTried: false }));
    expect(suggestion("s-1")).toMatchObject({ tried: false, felt: null, outcomeScore: NOT_TRIED_SCORE });
    // The Check-in keeps what the review heard.
    expect(store.checkIns.get(`${PATIENT_ID}/${first}`)?.previousTried).toBe(true);

    clock = NOW + DAY;
    suggest("s-2", NOW + DAY - 3_600_000);
    decisions = new FakeDecisions(decisionsReply({ crisis: 0.02, decline: 0.05, triedLast: 0.1 }));
    const second = await started();
    await finish({ checkInId: second }, reply({ previousTried: null, previousFelt: null }));
    expect(suggestion("s-2")).toMatchObject({ tried: false, outcomeScore: NOT_TRIED_SCORE, outcomeCheckInId: second });
  });

  it("uses the Decisions answer when the Summary is minimal", async () => {
    suggest("s-walk", NOW - DAY);
    decisions = new FakeDecisions(decisionsReply({ crisis: 0.02, decline: 0.05, triedLast: 0.9 }));
    const checkInId = await started();
    const result = await finish({ checkInId }, new FakeTextModel("not json"));
    expect(result.minimal).toBe(true);
    expect(suggestion("s-walk")).toMatchObject({ tried: true, felt: null, outcomeScore: 0, outcomeCheckInId: checkInId });
  });

  it("keeps 'prefer not to say' unknown: answered, no score, and not asked again", async () => {
    suggest("s-walk", NOW - DAY);
    dailyFor(NOW - DAY, 0.5);
    decisions = new FakeDecisions(decisionsReply({ crisis: 0.02, decline: 0.05, triedLast: 0.9 }));
    const checkInId = await started();
    const textModel = reply({ previousTried: null, previousFelt: null, previousPreferNotToSay: true });
    await finish({ checkInId }, textModel);
    expect(suggestion("s-walk")).toMatchObject({ tried: null, felt: null, objectiveChange: null, outcomeScore: null, outcomeCheckInId: checkInId });

    clock = NOW + DAY;
    const next = await started();
    const nextModel = reply();
    await finish({ checkInId: next }, nextModel);
    expect(nextModel.requests[0]!.input).toContain("There was no previous Suggestion to ask about.");
    expect(suggestion("s-walk").outcomeCheckInId).toBe(checkInId);
  });

  it("leaves the Outcome open when nothing was heard either way", async () => {
    suggest("s-walk", NOW - DAY);
    const checkInId = await started();
    await finish({ checkInId }, reply({ previousTried: null, previousFelt: null }));
    expect(suggestion("s-walk")).toMatchObject({ tried: null, outcomeScore: null, outcomeCheckInId: null });
    expect(suggestionWrites()).toEqual([]);

    // The next Check-in asks again.
    clock = NOW + DAY;
    const next = await started();
    await finish({ checkInId: next, lastSuggestionId: "s-walk" });
    expect(suggestion("s-walk")).toMatchObject({ tried: true, outcomeCheckInId: next });
  });

  it("never gives a declined or proposed Suggestion an Outcome", async () => {
    suggest("s-accepted", NOW - 3 * DAY);
    suggest("s-declined", NOW - DAY, { status: "declined" });
    suggest("s-proposed", NOW - 2 * DAY, { status: "proposed" });
    const checkInId = await started();
    // The phone names the declined one: the answer is about it, so nothing is written anywhere.
    await finish({ checkInId, lastSuggestionId: "s-declined" });
    expect(suggestionWrites()).toEqual([]);
    expect(suggestion("s-declined").tried).toBeNull();

    // Without a name, the Outcome lands on the accepted one.
    const next = await started();
    await finish({ checkInId: next });
    expect(suggestion("s-accepted")).toMatchObject({ tried: true, outcomeCheckInId: next });
    expect(suggestion("s-declined").tried).toBeNull();
    expect(suggestion("s-proposed").tried).toBeNull();
  });

  it("never lands on a Suggestion made in the same Check-in", async () => {
    suggest("s-before", NOW - DAY);
    const checkInId = await started();
    // Recorded by the phone during this Check-in; one with a slow clock looks older than the start.
    suggest("s-now", NOW + 60_000);
    suggest("s-slow-clock", NOW - 60_000);
    const draft = { ...DRAFT, suggestions: [{ id: "s-slow-clock", kind: "music", details: "One song", status: "accepted" }] };
    await finish({ checkInId, draft });
    expect(suggestion("s-before")).toMatchObject({ tried: true, outcomeCheckInId: checkInId });
    expect(suggestion("s-now").tried).toBeNull();
    expect(suggestion("s-slow-clock").tried).toBeNull();
  });

  it("applies an Outcome once: a retry keeps the first, and a late retry never overwrites a later Check-in's", async () => {
    suggest("s-1", NOW - DAY);
    const first = await started();
    await finish({ checkInId: first, lastSuggestionId: "s-1" }, reply({ previousFelt: 5 }));
    const recordedOutcome = structuredClone(suggestion("s-1"));
    expect(recordedOutcome).toMatchObject({ tried: true, felt: 5, outcomeScore: 0.7, outcomeCheckInId: first });

    // The phone never got the reply and retries; the model hears it differently this time.
    await finish({ checkInId: first, lastSuggestionId: "s-1" }, reply({ previousTried: false }));
    expect(suggestion("s-1")).toEqual(recordedOutcome);

    // The next Check-in answers the next Suggestion; then a very late retry of the first arrives.
    clock = NOW + DAY;
    suggest("s-0", NOW - 5 * DAY);
    suggest("s-2", NOW + 2 * 3_600_000);
    const second = await started();
    await finish({ checkInId: second, lastSuggestionId: "s-2" }, reply({ previousFelt: 2 }));
    expect(suggestion("s-2")).toMatchObject({ tried: true, felt: 2, outcomeCheckInId: second });
    const writes = suggestionWrites().length;
    await finish({ checkInId: first, lastSuggestionId: "s-1" }, reply({ previousTried: false }));
    expect(suggestionWrites()).toHaveLength(writes);
    expect(suggestion("s-1")).toEqual(recordedOutcome);
    expect(suggestion("s-0").outcomeCheckInId).toBeNull();
  });

  it("a failed finish records no Outcome, and the retry does", async () => {
    suggest("s-walk", NOW - DAY);
    const checkInId = await started();
    await expect(finish({ checkInId }, failingTextModel(503))).rejects.toMatchObject({ code: "unavailable" });
    expect(suggestion("s-walk").outcomeCheckInId).toBeNull();
    decisions = decisionsTimeout();
    await finish({ checkInId });
    expect(suggestion("s-walk")).toMatchObject({ tried: true, outcomeCheckInId: checkInId });
  });

  it("stores no step change when the Patient has left steps out", async () => {
    suggest("s-walk", NOW - DAY);
    dailyFor(NOW - DAY, 1.5);
    store.consents.set(`${PATIENT_ID}/steps`, false);
    const checkInId = await started();
    await finish({ checkInId }, reply({ previousFelt: 4 }));
    expect(suggestion("s-walk")).toMatchObject({ objectiveChange: null, outcomeScore: 0.35 });
  });

  it("computes the step change by the Baseline rule when the day's record has no comparison", async () => {
    const at = NOW - DAY;
    suggest("s-walk", at);
    for (let d = 1; d <= 5; d++) {
      const date = outcomeDay(at - d * DAY);
      store.daily.set(`${PATIENT_ID}/${date}`, { date, values: { steps: 5000 }, vsBaseline: {}, sharedWithClinician: true });
    }
    // A constant history: the spread is floored at 5% of 5000, so 5500 steps is +2, clamped to +1 in the score.
    dailyFor(at, null, 5500);
    const checkInId = await started();
    await finish({ checkInId }, reply({ previousFelt: 3 }));
    expect(suggestion("s-walk").objectiveChange).toBeCloseTo(2, 9);
    expect(suggestion("s-walk").outcomeScore).toBeCloseTo(0.3, 9);
  });

  it("updates the stored score that the dashboard's 'what seems to help' reads", async () => {
    suggest("s-walk", NOW - DAY);
    suggest("s-music", NOW - 2 * DAY, { kind: "music", tried: true, felt: 3, outcomeScore: 0, outcomeCheckInId: "c-earlier" });
    const read = () => whatHelps([...store.suggestions.values()], { ...whatHelpsWindow(outcomeDay(NOW)), timeZone: "Europe/Helsinki" });
    expect(read()).toMatchObject({ rows: [{ kind: "music", n: 1 }], waiting: 1 });

    const checkInId = await started();
    await finish({ checkInId }, reply({ previousFelt: 5 }));
    const { rows, waiting } = read();
    expect(rows.map((r) => [r.kind, r.n, r.feelings.better])).toEqual([["walk", 1, 1], ["music", 1, 0]]);
    expect(waiting).toBe(0);
  });

  it("a silent Check-in records no Outcome", async () => {
    suggest("s-walk", NOW - DAY);
    const checkInId = await started();
    await finish({ checkInId, draft: { turns: [{ speaker: "companion", text: "Hello?" }] } });
    expect(suggestionWrites()).toEqual([]);
  });
});
