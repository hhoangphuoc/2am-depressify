import { describe, expect, it } from "vitest";
import { finishWrites, type FinishContent } from "../src/checkIn";
import { newPatientDoc } from "../src/types";

const patient = { ...newPatientDoc("Live patient", "clinician@example.com"), sharingConsent: "granted" as const };
const checkIn = { id: "c1", startedAtMillis: 1, sharedWithClinician: true };
const full: FinishContent = {
  mood: 3, energy: 2, sleepQuality: 4, sleepLine: "Slept less than usual.", themes: ["A tired week"], voiceCues: [],
  suggestion: "A short walk", previousOutcome: null, quotes: ["I slept badly"], crisis: false,
};
const minimal: FinishContent = { ...full, mood: null, energy: null, sleepQuality: null, sleepLine: "", themes: [], quotes: [], suggestion: null };

describe("a retried Finish Check-in", () => {
  it("keeps the Summary and ratings of an earlier attempt when the retry has no model output", () => {
    const first = finishWrites({ patient, checkIn, summary: undefined }, "c1", full, 1000);
    const retry = finishWrites({ patient, checkIn: { ...checkIn, ...first.checkIn }, summary: first.summary }, "c1", { ...minimal, crisis: true }, 2000);

    expect(retry.summary).toEqual(first.summary);
    expect(retry.checkIn.mood).toBe(3);
    // A crisis marker from the retry's draft still lands.
    expect(retry.checkIn.crisis).toBe(true);
  });

  it("still overwrites with a new full Summary, and a first minimal one is saved as it is", () => {
    const first = finishWrites({ patient, checkIn, summary: undefined }, "c1", minimal, 1000);
    expect(first.summary.themes).toEqual([]);
    const retry = finishWrites({ patient, checkIn, summary: first.summary }, "c1", full, 2000);
    expect(retry.summary.themes).toEqual(["A tired week"]);
    expect(retry.summary.createdAtMillis).toBe(1000);
  });
});
