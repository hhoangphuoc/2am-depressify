// Outcomes and learning what helps (#21): the shared fixture (fixtures/outcomes/outcome-cases.json,
// also read by core's Kotlin tests and the seed), which answer counts, the day's steps against
// Baseline, and the write that lands once per Suggestion.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NOT_TRIED_SCORE,
  objectiveChange,
  outcomeDailyNeeded,
  outcomeDay,
  outcomeScore,
  outcomeTarget,
  outcomeWrite,
  resolveOutcome,
  type HeardOutcome,
  type OutcomePlan,
  type StoredSuggestion,
} from "../src/outcomes";
import type { DailyDoc, Suggestion } from "../src/types";

const fixture = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "fixtures", "outcomes", "outcome-cases.json"), "utf8"));
const tolerance: number = fixture.rule.tolerance;

function expectClose(actual: number | null, expected: number | null) {
  if (expected === null) return expect(actual).toBeNull();
  expect(actual).not.toBeNull();
  expect(Math.abs(actual! - expected)).toBeLessThanOrEqual(tolerance);
}

describe("the shared Outcome fixture", () => {
  it.each(fixture.scores as { name: string; tried: boolean | null; felt: number | null; objectiveChange: number | null; expected: number | null }[])(
    "score: $name",
    (c) => expectClose(outcomeScore(c.tried, c.felt, c.objectiveChange), c.expected),
  );

  it.each(
    fixture.targets as {
      name: string;
      checkIn: { id: string; startedAtMillis: number };
      excludeIds: string[];
      suggestions: (Partial<Suggestion> & { id: string })[];
      expected: string | null;
    }[],
  )("target: $name", (c) => {
    const stored = c.suggestions.map(({ id, ...suggestion }) => ({ id, suggestion }));
    expect(outcomeTarget(stored, c.checkIn, c.excludeIds)?.id ?? null).toBe(c.expected);
  });
});

describe("outcomeScore", () => {
  it("is null until answered, whatever else is known", () => {
    expect(outcomeScore(null, 5, 1)).toBeNull();
    expect(outcomeScore(undefined, null, null)).toBeNull();
  });

  it("a missing step change contributes nothing", () => {
    expect(outcomeScore(true, 5, null)).toBeCloseTo(0.7, 12);
    expect(outcomeScore(true, 5, Number.NaN)).toBeCloseTo(0.7, 12);
  });

  it("stays within plus or minus 1", () => {
    for (const felt of [1, 2, 3, 4, 5, null]) {
      for (const change of [-100, -1, 0, 1, 100, null]) {
        const score = outcomeScore(true, felt, change)!;
        expect(score).toBeGreaterThanOrEqual(-1);
        expect(score).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("resolveOutcome: which answer counts", () => {
  const heard = (h: Partial<HeardOutcome>): HeardOutcome => ({ previousTried: null, previousFelt: null, previousPreferNotToSay: false, ...h });

  it("the text model's extraction wins over the Decisions answer", () => {
    expect(resolveOutcome(heard({ previousTried: true, previousFelt: 4 }), "no")).toEqual({ tried: true, felt: 4 });
    expect(resolveOutcome(heard({ previousTried: false, previousFelt: 4 }), "yes")).toEqual({ tried: false, felt: null });
  });

  it("'prefer not to say' is an answer, unknown, and the Decisions answer does not override it", () => {
    expect(resolveOutcome(heard({ previousPreferNotToSay: true }), "yes")).toEqual({ tried: null, felt: null });
  });

  it("the Decisions answer decides only when the extraction is unsure", () => {
    expect(resolveOutcome(heard({ previousFelt: 2 }), "yes")).toEqual({ tried: true, felt: 2 });
    expect(resolveOutcome(heard({}), "no")).toEqual({ tried: false, felt: null });
    // A minimal Summary (no usable model reply) leaves the Decisions answer alone.
    expect(resolveOutcome(null, "yes")).toEqual({ tried: true, felt: null });
  });

  it("nothing heard: no answer, and the Outcome stays open", () => {
    expect(resolveOutcome(heard({}), "unknown")).toBeNull();
    expect(resolveOutcome(null, "unknown")).toBeNull();
  });

  it("drops a feeling outside 1 to 5", () => {
    expect(resolveOutcome(heard({ previousTried: true, previousFelt: 9 }), "unknown")).toEqual({ tried: true, felt: null });
  });
});

/** A daily record with steps and, optionally, a stored comparison. */
const day = (date: string, steps: number | null, vsSteps?: number | null): Partial<DailyDoc> => ({
  date,
  values: { steps },
  vsBaseline: vsSteps === undefined ? {} : { steps: vsSteps },
});
const fortnight = (end: number, steps: number[]) =>
  steps.map((value, i) => day(`2026-11-${String(end - steps.length + i).padStart(2, "0")}`, value));

describe("objectiveChange: the day's steps against Baseline", () => {
  it("reuses the daily record's stored comparison", () => {
    expect(objectiveChange([day("2026-11-12", 9000, 1.25)], "2026-11-12")).toBe(1.25);
  });

  it("computes it by the shared Baseline rule when the record has none", () => {
    // Baseline from 2026-11-07..11: median 5000; steps 6000 that day.
    const history = fortnight(12, [4000, 5000, 6000, 5000, 5000]);
    const expected = (6000 - 5000) / Math.max(Math.sqrt(((4000 - 5000) ** 2 + (6000 - 5000) ** 2) / 4), 0.05 * 5000);
    expect(objectiveChange([...history, day("2026-11-12", 6000)], "2026-11-12")).toBeCloseTo(expected, 9);
    expect(objectiveChange([...history, day("2026-11-12", 6000, null)], "2026-11-12")).toBeCloseTo(expected, 9);
  });

  it("is null without a record for the day, without steps that day, or with too few days before it", () => {
    expect(objectiveChange([], "2026-11-12")).toBeNull();
    expect(objectiveChange([...fortnight(12, [4000, 5000, 6000, 5000, 5000]), day("2026-11-12", null)], "2026-11-12")).toBeNull();
    expect(objectiveChange([...fortnight(12, [4000, 5000, 6000, 5000]), day("2026-11-12", 6000)], "2026-11-12")).toBeNull();
  });

  it("takes the day the Suggestion was made, in Helsinki", () => {
    // 2026-11-12 23:30 in Helsinki is 21:30 UTC.
    expect(outcomeDay(Date.UTC(2026, 10, 12, 21, 30))).toBe("2026-11-12");
    expect(outcomeDay(Date.UTC(2026, 10, 12, 22, 30))).toBe("2026-11-13");
  });
});

describe("outcomeWrite", () => {
  const AT = Date.UTC(2026, 10, 12, 16, 0); // 2026-11-12 in Helsinki
  const open: StoredSuggestion = {
    id: "s-walk",
    suggestion: { kind: "walk", details: "A short walk", status: "accepted", suggestedAtMillis: AT, tried: null, felt: null, objectiveChange: null, outcomeScore: null, outcomeCheckInId: null, sharedWithClinician: true },
  };
  const plan = (p: Partial<OutcomePlan> = {}): OutcomePlan => ({ suggestionId: "s-walk", answer: { tried: true, felt: 5 }, stepsAllowed: true, excludeIds: [], ...p });
  const daily = [day("2026-11-12", 9000, 0.5)];

  it("tried: the feeling, the day's steps and the score, with the Check-in that recorded it", () => {
    expect(outcomeWrite(open, plan(), daily, "c-now")).toEqual({
      id: "s-walk",
      fields: { tried: true, felt: 5, objectiveChange: 0.5, outcomeScore: 0.7 + 0.3 * 0.5, outcomeCheckInId: "c-now" },
    });
  });

  it("not tried: -0.1, no feeling, the steps stored but not counted", () => {
    expect(outcomeWrite(open, plan({ answer: { tried: false, felt: 4 } }), daily, "c-now")!.fields).toEqual({
      tried: false, felt: null, objectiveChange: 0.5, outcomeScore: NOT_TRIED_SCORE, outcomeCheckInId: "c-now",
    });
  });

  it("prefer not to say: answered, unknown, no score and no steps", () => {
    expect(outcomeWrite(open, plan({ answer: { tried: null, felt: null } }), daily, "c-now")!.fields).toEqual({
      tried: null, felt: null, objectiveChange: null, outcomeScore: null, outcomeCheckInId: "c-now",
    });
  });

  it("a missing step change leaves the score to the feeling", () => {
    expect(outcomeWrite(open, plan({ answer: { tried: true, felt: 4 } }), [], "c-now")!.fields).toMatchObject({ objectiveChange: null, outcomeScore: 0.35 });
  });

  it("no steps when the Patient has left steps out", () => {
    expect(outcomeWrite(open, plan({ stepsAllowed: false }), daily, "c-now")!.fields).toMatchObject({ objectiveChange: null, outcomeScore: 0.7 });
  });

  it("is applied once: a Suggestion with an Outcome, from this Check-in or another, is left alone", () => {
    for (const recorded of ["c-now", "c-later"]) {
      const answered = { ...open, suggestion: { ...open.suggestion, tried: false, outcomeScore: NOT_TRIED_SCORE, outcomeCheckInId: recorded } };
      expect(outcomeWrite(answered, plan(), daily, "c-now")).toBeNull();
    }
  });

  it("nothing without a plan, when the target changed, or for a Suggestion that is not accepted", () => {
    expect(outcomeWrite(open, null, daily, "c-now")).toBeNull();
    expect(outcomeWrite(undefined, plan(), daily, "c-now")).toBeNull();
    expect(outcomeWrite(open, plan({ suggestionId: "s-other" }), daily, "c-now")).toBeNull();
    expect(outcomeWrite({ ...open, suggestion: { ...open.suggestion, status: "declined" } }, plan(), daily, "c-now")).toBeNull();
  });

  it("names the daily records to read only when a write with steps will happen", () => {
    expect(outcomeDailyNeeded(open, plan())).toEqual({ start: "2026-10-29", end: "2026-11-12" });
    expect(outcomeDailyNeeded(open, plan({ answer: { tried: null, felt: null } }))).toBeNull();
    expect(outcomeDailyNeeded(open, plan({ stepsAllowed: false }))).toBeNull();
    expect(outcomeDailyNeeded(open, plan({ suggestionId: "s-other" }))).toBeNull();
    expect(outcomeDailyNeeded(open, null)).toBeNull();
  });
});
