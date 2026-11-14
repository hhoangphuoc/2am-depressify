// The Decisions part of Finish Check-in (#20), all pure: the request, reading the answers, telling a
// safety refusal from other failures, routing the answers to flags, and the flag writes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { transcriptText, type CheckInDraft } from "../src/checkIn";
import { DecisionsError } from "../src/decisionsApi";
import {
  CRISIS_FROM_CHECK_IN_REASON,
  CRISIS_FROM_REVIEW_REASON,
  DECISION_QUESTIONS,
  DECISION_THRESHOLDS,
  DECLINE_REASON,
  SAFETY_REFUSAL_CODES,
  UNASSESSED_REASON,
  buildDecisionsRequest,
  decisionFlagId,
  decisionFlagWrites,
  decisionsFailure,
  parseDecisionAnswers,
  routeDecisions,
  triedValue,
  type DecisionsOutcome,
  type RoutedFlag,
} from "../src/decisions";
import type { StoredFlag } from "../src/flags";
import { newPatientDoc, type Flag, type PatientDoc } from "../src/types";

const SPIKE = join(__dirname, "..", "..", "..", "fixtures", "spike", "decisions");
const fixture = (name: string) => JSON.parse(readFileSync(join(SPIKE, name), "utf8"));
const routine = fixture("finish-checkin-routine.json");
const crisis = fixture("finish-checkin-crisis.json");
const refusal = fixture("safety-refusal-documented.json");
const invalid = fixture("error-invalid-question-type.json");

const DRAFT: CheckInDraft = {
  turns: [
    { speaker: "companion", text: "Hi Alex. Did you try the walk by the harbour?" },
    { speaker: "patient", text: "Yeah, I went on Saturday. I felt a bit lighter after." },
  ],
  voiceCues: [],
  suggestions: [],
  crisis: false,
};

const answered = (crisisP: number, decline: number, triedLast: number | null = null): DecisionsOutcome => ({ kind: "answered", crisis: crisisP, decline, triedLast });

describe("the Decisions request", () => {
  it("is the recorded shape: the model, the transcript as input, and the three noul questions", () => {
    const request = buildDecisionsRequest(transcriptText(DRAFT.turns), "A short walk by the harbour");
    expect(request.model).toBe("gemini-decision-1");
    expect(request.input).toContain("Check-in transcript:\nCompanion: Hi Alex. Did you try the walk by the harbour?\nPatient: Yeah, I went on Saturday.");
    expect(request.input).toContain("The previous Suggestion the Companion asked about: A short walk by the harbour");
    expect(Object.keys(request.questions)).toEqual(["crisis", "decline", "triedLast"]);
    // The spike's wording, which both recorded transcripts routed correctly with.
    expect(request.questions).toEqual(routine.request.body.questions);
    for (const question of Object.values(request.questions)) expect(question.type).toBe("noul");
  });

  it("asks only about crisis and decline when there was no previous Suggestion", () => {
    const request = buildDecisionsRequest(transcriptText(DRAFT.turns), null);
    expect(Object.keys(request.questions)).toEqual(["crisis", "decline"]);
    expect(request.input.startsWith("Check-in transcript:\n")).toBe(true);
    expect(request.input).not.toContain("previous Suggestion");
  });

  it("keeps the questions in one place", () => {
    expect(DECISION_QUESTIONS.crisis).toBe(crisis.request.body.questions.crisis.instructions);
  });
});

describe("reading the answers", () => {
  it("reads the recorded routine and crisis replies", () => {
    expect(parseDecisionAnswers(routine.response.body, true)).toEqual({
      kind: "answered",
      crisis: routine.response.body.answers.crisis.noul,
      decline: routine.response.body.answers.decline.noul,
      triedLast: routine.response.body.answers.triedLast.noul,
    });
    expect(parseDecisionAnswers(crisis.response.body, true)).toMatchObject({ kind: "answered", triedLast: 0.01 });
  });

  it("ignores a triedLast answer it did not ask for, and treats a missing or bad one as unknown", () => {
    expect(parseDecisionAnswers(routine.response.body, false)).toMatchObject({ kind: "answered", triedLast: null });
    const body = structuredClone(routine.response.body);
    body.answers.triedLast.noul = "yes";
    expect(parseDecisionAnswers(body, true)).toMatchObject({ kind: "answered", triedLast: null });
  });

  it("counts a reply without a usable crisis or decline answer as a failure", () => {
    for (const mutate of [
      (b: any) => delete b.answers.crisis,
      (b: any) => (b.answers.decline.noul = 1.5),
      (b: any) => (b.answers.crisis.noul = null),
      (b: any) => (b.answers.decline = "no"),
      (b: any) => delete b.answers,
    ]) {
      const body = structuredClone(routine.response.body);
      mutate(body);
      expect(parseDecisionAnswers(body, true)).toEqual({ kind: "failed" });
    }
    for (const body of [null, "text", [], 3]) expect(parseDecisionAnswers(body, true)).toEqual({ kind: "failed" });
  });
});

describe("a failed call", () => {
  it("is a safety refusal when it is HTTP 400 with one of the documented safety codes", () => {
    expect(SAFETY_REFUSAL_CODES).toEqual(["safety", "prohibited_content", "blocklist", "image_safety", "content_blocked"]);
    expect(decisionsFailure(new DecisionsError(400, refusal.response.body.error.code))).toEqual({ kind: "refused" });
    for (const code of SAFETY_REFUSAL_CODES) expect(decisionsFailure(new DecisionsError(400, code))).toEqual({ kind: "refused" });
  });

  it("is a plain failure otherwise: a timeout, another 400, a server error, anything else", () => {
    expect(decisionsFailure(new DecisionsError(400, invalid.response.body.error.code))).toEqual({ kind: "failed" });
    expect(decisionsFailure(new DecisionsError(null, null))).toEqual({ kind: "failed" });
    expect(decisionsFailure(new DecisionsError(500, "safety"))).toEqual({ kind: "failed" });
    expect(decisionsFailure(new DecisionsError(429, null))).toEqual({ kind: "failed" });
    expect(decisionsFailure(new Error("timed out"))).toEqual({ kind: "failed" });
    expect(decisionsFailure("boom")).toEqual({ kind: "failed" });
  });
});

describe("routing the answers (spec #5, starting values)", () => {
  it("keeps the thresholds in one place, as the spec's starting values", () => {
    expect(DECISION_THRESHOLDS).toEqual({ crisis: 0.5, decline: 0.6, triedYes: 0.6, triedNo: 0.4 });
  });

  it("crisis at or above 0.5 gives red crisis", () => {
    expect(routeDecisions(answered(0.5, 0), false)).toEqual({
      assessment: "assessed",
      flags: [{ kind: "crisis", level: "red", reason: CRISIS_FROM_REVIEW_REASON }],
      tried: "unknown",
    });
    expect(routeDecisions(answered(0.4999, 0), false).flags).toEqual([]);
  });

  it("the draft's crisis marker gives red crisis even when the model says no", () => {
    expect(routeDecisions(answered(0.02, 0.05), true).flags).toEqual([{ kind: "crisis", level: "red", reason: CRISIS_FROM_CHECK_IN_REASON }]);
    expect(routeDecisions(answered(0.9, 0.05), true).flags).toEqual([{ kind: "crisis", level: "red", reason: CRISIS_FROM_CHECK_IN_REASON }]);
  });

  it("decline at or above 0.6 gives amber decline", () => {
    expect(routeDecisions(answered(0, 0.6), false).flags).toEqual([{ kind: "decline", level: "amber", reason: DECLINE_REASON }]);
    expect(routeDecisions(answered(0, 0.5999), false).flags).toEqual([]);
  });

  it("crisis and decline together give both flags, red first", () => {
    expect(routeDecisions(answered(0.93, 0.99, 0.01), false)).toEqual({
      assessment: "assessed",
      flags: [
        { kind: "crisis", level: "red", reason: CRISIS_FROM_REVIEW_REASON },
        { kind: "decline", level: "amber", reason: DECLINE_REASON },
      ],
      tried: "no",
    });
  });

  it("routes both recorded transcripts as the spike expected", () => {
    const read = (f: typeof routine) => parseDecisionAnswers(f.response.body, true);
    expect(routeDecisions(read(routine), false)).toEqual({ assessment: "assessed", flags: [], tried: "yes" });
    expect(routeDecisions(read(crisis), false).flags.map((f) => f.kind)).toEqual(["crisis", "decline"]);
  });

  it("a safety refusal gives amber unassessed, 'could not be assessed automatically'", () => {
    expect(routeDecisions({ kind: "refused" }, false)).toEqual({
      assessment: "unassessed",
      flags: [{ kind: "unassessed", level: "amber", reason: UNASSESSED_REASON }],
      tried: "unknown",
    });
    expect(UNASSESSED_REASON).toContain("could not be assessed automatically");
    // With the draft's crisis marker, the red crisis is raised as well.
    expect(routeDecisions({ kind: "refused" }, true).flags.map((f) => `${f.level} ${f.kind}`)).toEqual(["red crisis", "amber unassessed"]);
  });

  it("a timeout or other failure gives no flag and 'assessment unavailable', never a fabricated green", () => {
    expect(routeDecisions({ kind: "failed" }, false)).toEqual({ assessment: "unavailable", flags: [], tried: "unknown" });
    // The draft's crisis marker still gives red crisis.
    expect(routeDecisions({ kind: "failed" }, true)).toEqual({
      assessment: "unavailable",
      flags: [{ kind: "crisis", level: "red", reason: CRISIS_FROM_CHECK_IN_REASON }],
      tried: "unknown",
    });
  });

  it("a Check-in the Patient said nothing in is not reviewed, but its crisis marker still counts", () => {
    expect(routeDecisions({ kind: "skipped" }, false)).toEqual({ assessment: null, flags: [], tried: "unknown" });
    expect(routeDecisions({ kind: "skipped" }, true).flags.map((f) => f.kind)).toEqual(["crisis"]);
  });

  it("tried is yes at or above 0.6, no at or below 0.4, otherwise unknown", () => {
    const tried = (p: number | null) => routeDecisions(answered(0, 0, p), false).tried;
    expect([tried(0.6), tried(0.98), tried(0.4), tried(0.01), tried(0.5), tried(0.41), tried(0.59), tried(null)]).toEqual([
      "yes", "yes", "no", "no", "unknown", "unknown", "unknown", "unknown",
    ]);
    expect([triedValue("yes"), triedValue("no"), triedValue("unknown")]).toEqual([true, false, null]);
  });

  it("every reason is a plain sentence with no number that reads as a score", () => {
    for (const reason of [CRISIS_FROM_CHECK_IN_REASON, CRISIS_FROM_REVIEW_REASON, DECLINE_REASON, UNASSESSED_REASON]) {
      expect(reason).toMatch(/^[A-Z][^0-9%]*\.$/);
      expect(reason.toLowerCase()).not.toMatch(/score|risk|probab|confiden|diagnos/);
    }
  });
});

describe("the flag writes", () => {
  const NOW = 1_763_000_000_000;
  const sharing = { ...newPatientDoc("Live patient", "clinician@example.com"), sharingConsent: "granted" as const };
  const checkIn = { id: "c1", sharedWithClinician: true };
  const red = { kind: "crisis" as const, level: "red" as const, reason: CRISIS_FROM_REVIEW_REASON };
  const amber = { kind: "decline" as const, level: "amber" as const, reason: DECLINE_REASON };
  const stored = (id: string, flag: Partial<Flag>): StoredFlag => ({ id, flag: { level: "red", kind: "crisis", reason: "r.", raisedAtMillis: 1, clearedAtMillis: null, sharedWithClinician: true, ...flag } });
  const writes = (patient: Partial<PatientDoc>, flags: StoredFlag[], routed: RoutedFlag[] = [red], ci: object = checkIn) =>
    decisionFlagWrites({ patient, checkIn: ci, flags }, "c1", routed, NOW);

  it("one flag per Check-in and kind, at a fixed id, stamped like the Summary, raising the level", () => {
    expect(decisionFlagId("crisis", "c1")).toBe("crisis-c1");
    expect(writes(sharing, [])).toEqual({
      flags: [{ id: "crisis-c1", flag: { level: "red", kind: "crisis", reason: CRISIS_FROM_REVIEW_REASON, raisedAtMillis: NOW, clearedAtMillis: null, sharedWithClinician: true } }],
      attention: { flagLevel: "red", flagReasons: [CRISIS_FROM_REVIEW_REASON] },
    });
  });

  it("red and amber together: level red, the red reason first, the record's reasons kept", () => {
    const patient = { ...sharing, flagLevel: "amber" as const, flagReasons: ["Poor sleep on the last three nights."] };
    expect(writes(patient, [], [red, amber]).attention).toEqual({
      flagLevel: "red",
      flagReasons: [CRISIS_FROM_REVIEW_REASON, "Poor sleep on the last three nights.", DECLINE_REASON],
    });
  });

  it("an uncleared red is never lowered by a new amber", () => {
    const patient = { ...sharing, flagLevel: "red" as const, flagReasons: ["The phone has been quiet."] };
    expect(writes(patient, [], [amber]).attention).toEqual({ flagLevel: "red", flagReasons: ["The phone has been quiet.", DECLINE_REASON] });
  });

  it("does not raise a kind that already has an uncleared flag with the same stamp (the phone's own crisis flag)", () => {
    expect(writes(sharing, [stored("crisis-1762999999000", {})])).toEqual({ flags: [], attention: null });
    // Cleared, or stamped the other way: raised.
    expect(writes(sharing, [stored("crisis-1", { clearedAtMillis: 5 })]).flags.map((f) => f.id)).toEqual(["crisis-c1"]);
    expect(writes(sharing, [stored("crisis-1", { sharedWithClinician: false })]).flags.map((f) => f.id)).toEqual(["crisis-c1"]);
    // Another kind does not count.
    expect(writes(sharing, [stored("decline-c0", { kind: "decline", level: "amber" })]).flags.map((f) => f.id)).toEqual(["crisis-c1"]);
  });

  it("a retried finish never raises this Check-in's flag twice, even after the Clinician cleared it", () => {
    expect(writes(sharing, [stored("crisis-c1", {})]).flags).toEqual([]);
    expect(writes(sharing, [stored("crisis-c1", { clearedAtMillis: 5 })])).toEqual({ flags: [], attention: null });
  });

  it("stamps false, and leaves the level alone, when the Patient is not sharing or the Check-in was not", () => {
    for (const [patient, ci] of [
      [{ ...sharing, sharingConsent: "declined" as const }, checkIn],
      [sharing, { ...checkIn, sharedWithClinician: false }],
    ] as const) {
      const result = writes(patient, [], [red], ci);
      expect(result.flags.map((f) => f.flag.sharedWithClinician)).toEqual([false]);
      expect(result.attention).toBeNull();
    }
  });

  it("writes nothing when there is nothing to raise", () => {
    expect(writes(sharing, [], [])).toEqual({ flags: [], attention: null });
  });
});
