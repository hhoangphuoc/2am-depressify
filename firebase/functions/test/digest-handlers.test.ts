// The Digest handlers with an in-memory store and a fake text model. test/emulator/digest.test.ts
// runs the same handlers against the Firestore emulator with the seeded Demo Patients.
import { HttpsError } from "firebase-functions/v2/https";
import { describe, expect, it } from "vitest";
import { zonedMidnightMillis } from "../src/digest";
import { generateDigestHandler, weeklyDigestHandler } from "../src/digestFunctions";
import { newPatientDoc, type DailyDoc, type Digest, type PatientDoc, type Summary } from "../src/types";
import { CLINICIAN_EMAIL, FakeDigestStore, FakeTextModel, anonymousPatient, clinician, failingTextModel, otherClinician } from "./fakes";

const HOUR = 3_600_000;
/** Saturday 14 November 2026, 12:00 in Helsinki: "Generate now" covers 2026-W46 so far. */
const SATURDAY_NOON = Date.parse("2026-11-14T10:00:00Z");
/** Monday 16 November 2026, 07:00 in Helsinki: the weekly job covers 2026-W46. */
const MONDAY_0700 = Date.parse("2026-11-16T05:00:00Z");
const MODEL_TEXT = "Mood was rated low on both days. Sleep was shorter than usual.";

const sharing = (name: string, overrides: Partial<PatientDoc> = {}): PatientDoc => ({
  ...newPatientDoc(name, CLINICIAN_EMAIL),
  sharingConsent: "granted",
  ...overrides,
});

function summary(date: string, theme: string): Summary {
  return {
    checkInId: `checkin-${date}`,
    createdAtMillis: zonedMidnightMillis(date) + 19 * HOUR,
    mood: 2,
    energy: 2,
    sleepQuality: 3,
    sleepLine: "Slept about 6 h",
    themes: [theme],
    voiceCues: [],
    suggestion: null,
    previousOutcome: null,
    quotes: [],
    sharedWithClinician: true,
  };
}

function day(date: string): DailyDoc {
  return { date, values: { steps: 3000 }, vsBaseline: { steps: -1.1 }, composite: -1.1, demoOverride: false, sharedWithClinician: true };
}

const W46_SUMMARIES = [summary("2026-11-10", "work stress"), summary("2026-11-12", "missing friends")];
const W46_DAYS = [day("2026-11-10"), day("2026-11-11")];

function store(): FakeDigestStore {
  return new FakeDigestStore({
    p1: { patient: sharing("Declining"), summaries: [...W46_SUMMARIES, summary("2026-11-03", "older week")], days: W46_DAYS },
    quiet: { patient: sharing("Quiet"), days: W46_DAYS },
    declined: { patient: sharing("Declined", { sharingConsent: "declined" }), summaries: W46_SUMMARIES },
    undecided: { patient: sharing("Undecided", { sharingConsent: "undecided" }), summaries: W46_SUMMARIES },
  });
}

async function rejection(promise: Promise<unknown>): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpsError);
    return error as HttpsError;
  }
  throw new Error("expected the call to be rejected");
}

describe("generateDigest (Generate now)", () => {
  it("writes this week's Digest from the model, with the dates covered, the time and the Summary count", async () => {
    const s = store();
    const model = new FakeTextModel(MODEL_TEXT);
    const result = await generateDigestHandler(
      { data: { patientId: "p1" }, auth: clinician },
      { store: s, textModel: model, nowMillis: () => SATURDAY_NOON },
    );

    const expected: Digest = {
      isoWeek: "2026-W46",
      weekStart: "2026-11-09",
      weekEnd: "2026-11-14",
      summaryCount: 2,
      sourceCheckInIds: ["checkin-2026-11-10", "checkin-2026-11-12"],
      text: MODEL_TEXT,
      generatedAtMillis: SATURDAY_NOON,
      sharedWithClinician: true,
    };
    expect(result).toEqual({ digest: expected });
    expect(s.writes).toEqual([{ patientId: "p1", digest: expected }]);

    expect(model.requests).toHaveLength(1);
    const input = model.requests[0]!.input;
    expect(input).toContain("work stress");
    expect(input).toContain("missing friends");
    expect(input).not.toContain("older week");
    expect(model.requests[0]!.store).toBe(false);
  });

  it("emptyWeekSaysNoCheckIns: a week with no Check-ins is written from fixed copy without calling the model", async () => {
    const s = store();
    const model = new FakeTextModel("invented");
    const { digest } = await generateDigestHandler(
      { data: { patientId: "quiet" }, auth: clinician },
      { store: s, textModel: model, nowMillis: () => SATURDAY_NOON },
    );
    expect(model.requests).toHaveLength(0);
    expect(digest.summaryCount).toBe(0);
    expect(digest.sourceCheckInIds).toEqual([]);
    expect(digest.text).toMatch(/no Check-ins/i);
    expect(digest.text).not.toContain("invented");
    expect(s.writes).toHaveLength(1);
  });

  it("a week that spans a time without sharing draws only on what was saved while sharing", async () => {
    const offPeriod = { ...summary("2026-11-11", "said while not sharing"), sharedWithClinician: false };
    const s = new FakeDigestStore({ p1: { patient: sharing("Back"), summaries: [summary("2026-11-12", "back again"), offPeriod], days: W46_DAYS } });
    const model = new FakeTextModel(MODEL_TEXT);
    const { digest } = await generateDigestHandler(
      { data: { patientId: "p1" }, auth: clinician },
      { store: s, textModel: model, nowMillis: () => SATURDAY_NOON },
    );
    expect(digest.summaryCount).toBe(1);
    // The source list names only what the Clinician may read: never the Summary from the off period.
    expect(digest.sourceCheckInIds).toEqual(["checkin-2026-11-12"]);
    expect(digest.sharedWithClinician).toBe(true);
    expect(model.requests[0]!.input).toContain("back again");
    expect(model.requests[0]!.input).not.toContain("said while not sharing");
  });

  it("a week whose only Check-ins were saved while not sharing reads as a week with no Check-ins", async () => {
    const offPeriod = { ...summary("2026-11-11", "said while not sharing"), sharedWithClinician: false };
    const s = new FakeDigestStore({ p1: { patient: sharing("Back"), summaries: [offPeriod], days: W46_DAYS } });
    const model = new FakeTextModel("invented");
    const { digest } = await generateDigestHandler(
      { data: { patientId: "p1" }, auth: clinician },
      { store: s, textModel: model, nowMillis: () => SATURDAY_NOON },
    );
    expect(model.requests).toHaveLength(0);
    expect(digest.summaryCount).toBe(0);
    expect(digest.sourceCheckInIds).toEqual([]);
  });

  it("lists the Summaries it drew on, oldest first, one id per Summary counted", async () => {
    const late = summary("2026-11-13", "late");
    const early = summary("2026-11-09", "early");
    const s = new FakeDigestStore({ p1: { patient: sharing("Order"), summaries: [late, early, summary("2026-11-11", "middle")], days: W46_DAYS } });
    const { digest } = await generateDigestHandler(
      { data: { patientId: "p1" }, auth: clinician },
      { store: s, textModel: new FakeTextModel(MODEL_TEXT), nowMillis: () => SATURDAY_NOON },
    );
    expect(digest.sourceCheckInIds).toEqual(["checkin-2026-11-09", "checkin-2026-11-11", "checkin-2026-11-13"]);
    expect(digest.sourceCheckInIds).toHaveLength(digest.summaryCount);
  });

  it("regenerating overwrites the same week", async () => {
    const s = store();
    const deps = { store: s, nowMillis: () => SATURDAY_NOON };
    await generateDigestHandler({ data: { patientId: "p1" }, auth: clinician }, { ...deps, textModel: new FakeTextModel("First.") });
    await generateDigestHandler({ data: { patientId: "p1" }, auth: clinician }, { ...deps, textModel: new FakeTextModel("Second.") });
    expect(s.digests.get("p1")?.size).toBe(1);
    expect(s.digests.get("p1")?.get("2026-W46")?.text).toBe("Second.");
  });

  it.each([
    ["another Clinician", "p1", otherClinician, "permission-denied"],
    ["the anonymous Patient", "p1", anonymousPatient, "permission-denied"],
    ["a signed-out caller", "p1", undefined, "unauthenticated"],
    ["a Patient who declined sharing", "declined", clinician, "permission-denied"],
    ["a Patient who has not decided", "undecided", clinician, "permission-denied"],
    ["a Patient who does not exist", "nobody", clinician, "permission-denied"],
  ] as const)("refuses %s before reading data or calling the model", async (_name, patientId, auth, code) => {
    const s = store();
    const model = new FakeTextModel(MODEL_TEXT);
    const error = await rejection(
      generateDigestHandler({ data: { patientId }, auth }, { store: s, textModel: model, nowMillis: () => SATURDAY_NOON }),
    );
    expect(error.code).toBe(code);
    expect(model.requests).toHaveLength(0);
    expect(s.writes).toHaveLength(0);
  });

  it.each([[{}], [{ patientId: "" }], [{ patientId: "a/b" }], [null]])("refuses a bad request %j", async (data) => {
    const error = await rejection(
      generateDigestHandler({ data, auth: clinician }, { store: store(), textModel: new FakeTextModel(MODEL_TEXT), nowMillis: () => SATURDAY_NOON }),
    );
    expect(error.code).toBe("invalid-argument");
  });

  it("a failed model call writes nothing and names no data", async () => {
    const s = store();
    const error = await rejection(
      generateDigestHandler({ data: { patientId: "p1" }, auth: clinician }, { store: s, textModel: failingTextModel(), nowMillis: () => SATURDAY_NOON }),
    );
    expect(error.code).toBe("unavailable");
    expect(error.message).not.toContain("work stress");
    expect(s.writes).toHaveLength(0);
  });

  it("an empty model reply writes nothing", async () => {
    const s = store();
    const error = await rejection(
      generateDigestHandler({ data: { patientId: "p1" }, auth: clinician }, { store: s, textModel: new FakeTextModel("  "), nowMillis: () => SATURDAY_NOON }),
    );
    expect(error.code).toBe("unavailable");
    expect(s.writes).toHaveLength(0);
  });

  it("a failed write is reported as unavailable", async () => {
    const s = store();
    s.failWritesFor.add("p1");
    const error = await rejection(
      generateDigestHandler({ data: { patientId: "p1" }, auth: clinician }, { store: s, textModel: new FakeTextModel(MODEL_TEXT), nowMillis: () => SATURDAY_NOON }),
    );
    expect(error.code).toBe("unavailable");
  });
});

describe("weeklyDigest (Mondays 07:00 Helsinki)", () => {
  it("writes one Digest for the previous ISO week for every sharing Patient and skips the others", async () => {
    const s = store();
    const model = new FakeTextModel(MODEL_TEXT);
    const result = await weeklyDigestHandler(MONDAY_0700, { store: s, textModel: model });

    expect(result).toEqual({ isoWeek: "2026-W46", written: 2, noCheckIns: 1, notSharing: 2, failed: 0 });
    expect(s.writes.map((w) => w.patientId).sort()).toEqual(["p1", "quiet"]);
    const p1 = s.digests.get("p1")!.get("2026-W46")!;
    expect(p1).toEqual({
      isoWeek: "2026-W46",
      weekStart: "2026-11-09",
      weekEnd: "2026-11-15",
      summaryCount: 2,
      sourceCheckInIds: ["checkin-2026-11-10", "checkin-2026-11-12"],
      text: MODEL_TEXT,
      generatedAtMillis: MONDAY_0700,
      sharedWithClinician: true,
    });
    expect(s.digests.get("quiet")!.get("2026-W46")!.text).toMatch(/no Check-ins/i);
    // The model was called once, for the Patient with Check-ins, and never for a non-sharing one.
    expect(model.requests).toHaveLength(1);
  });

  it("one Patient's failure does not stop the others", async () => {
    const s = store();
    s.failWritesFor.add("p1");
    const result = await weeklyDigestHandler(MONDAY_0700, { store: s, textModel: new FakeTextModel(MODEL_TEXT) });
    expect(result).toMatchObject({ written: 1, failed: 1 });
    expect(s.digests.get("quiet")?.has("2026-W46")).toBe(true);
  });

  it("a failing model fails only the Patients with Check-ins", async () => {
    const s = store();
    const result = await weeklyDigestHandler(MONDAY_0700, { store: s, textModel: failingTextModel() });
    expect(result).toMatchObject({ written: 1, noCheckIns: 1, failed: 1 });
  });
});
