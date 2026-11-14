import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { QUESTIONNAIRE_RANGES, questionnaireLabel, sortVisits, validateTmsEndDate, validateVisit } from "../js/lib/visit.js";

const TODAY = "2026-11-14";
const form = (overrides = {}) => ({ date: "2026-11-10", questionnaire: "", score: "", ...overrides });

describe("validateVisit", () => {
  test("a Visit with no score is valid and stores nulls", () => {
    assert.deepEqual(validateVisit(form(), TODAY), {
      ok: true,
      visit: { date: "2026-11-10", questionnaire: null, score: null },
    });
  });

  test("today is allowed; a future date is rejected", () => {
    assert.equal(validateVisit(form({ date: TODAY }), TODAY).ok, true);
    const result = validateVisit(form({ date: "2026-11-15" }), TODAY);
    assert.equal(result.ok, false);
    assert.match(result.errors.date, /future/);
  });

  test("a missing or impossible date is rejected", () => {
    for (const date of ["", "2026-02-30", "soon"]) {
      const result = validateVisit(form({ date }), TODAY);
      assert.equal(result.ok, false, date);
      assert.ok(result.errors.date, date);
    }
  });

  test("PHQ-2 accepts 0 to 6 and rejects anything outside", () => {
    for (const score of ["0", "6", " 3 "]) {
      assert.deepEqual(validateVisit(form({ questionnaire: "phq2", score }), TODAY).visit, {
        date: "2026-11-10",
        questionnaire: "phq2",
        score: Number(score),
      });
    }
    for (const score of ["7", "-1", "27"]) {
      const result = validateVisit(form({ questionnaire: "phq2", score }), TODAY);
      assert.equal(result.ok, false, score);
      assert.match(result.errors.score, /0 to 6/);
    }
  });

  test("PHQ-9 accepts 0 to 27 and rejects anything outside", () => {
    assert.equal(validateVisit(form({ questionnaire: "phq9", score: "27" }), TODAY).visit.score, 27);
    assert.equal(validateVisit(form({ questionnaire: "phq9", score: 0 }), TODAY).visit.score, 0);
    const result = validateVisit(form({ questionnaire: "phq9", score: "28" }), TODAY);
    assert.equal(result.ok, false);
    assert.match(result.errors.score, /0 to 27/);
  });

  test("a score must be a whole number", () => {
    for (const score of ["4.5", "abc", "1e1", "0x3"]) {
      const result = validateVisit(form({ questionnaire: "phq9", score }), TODAY);
      assert.equal(result.ok, false, score);
      assert.match(result.errors.score, /whole number/, score);
    }
  });

  test("a score needs its Questionnaire, and a chosen Questionnaire needs its score", () => {
    const noKind = validateVisit(form({ score: "4" }), TODAY);
    assert.equal(noKind.ok, false);
    assert.match(noKind.errors.score, /PHQ-2 or PHQ-9/);
    const noScore = validateVisit(form({ questionnaire: "phq9" }), TODAY);
    assert.equal(noScore.ok, false);
    assert.match(noScore.errors.score, /PHQ-9 score/);
  });

  test("an unknown Questionnaire kind is rejected", () => {
    const result = validateVisit(form({ questionnaire: "gad7", score: "3" }), TODAY);
    assert.equal(result.ok, false);
    assert.ok(result.errors.questionnaire);
  });

  test("reports every problem at once", () => {
    const result = validateVisit(form({ date: "2027-01-01", questionnaire: "phq2", score: "9" }), TODAY);
    assert.deepEqual(Object.keys(result.errors).sort(), ["date", "score"]);
  });

  test("the saved Visit holds only date, Questionnaire and score: nothing about flags", () => {
    const { visit } = validateVisit(form({ questionnaire: "phq9", score: "9" }), TODAY);
    assert.deepEqual(Object.keys(visit), ["date", "questionnaire", "score"]);
  });
});

describe("validateTmsEndDate", () => {
  test("accepts a past date or today", () => {
    assert.deepEqual(validateTmsEndDate("2026-10-03", TODAY), { ok: true, date: "2026-10-03" });
    assert.deepEqual(validateTmsEndDate(TODAY, TODAY), { ok: true, date: TODAY });
  });

  test("rejects a future, missing or impossible date", () => {
    assert.match(validateTmsEndDate("2026-11-15", TODAY).error, /future/);
    assert.ok(validateTmsEndDate("", TODAY).error);
    assert.ok(validateTmsEndDate("2026-13-01", TODAY).error);
  });
});

test("ranges and labels", () => {
  assert.deepEqual(QUESTIONNAIRE_RANGES, { phq2: { min: 0, max: 6 }, phq9: { min: 0, max: 27 } });
  assert.equal(questionnaireLabel("phq2"), "PHQ-2");
  assert.equal(questionnaireLabel("phq9"), "PHQ-9");
});

test("sortVisits puts the newest Visit first and keeps invalid dates last", () => {
  const sorted = sortVisits([
    { id: "a", date: "2026-10-01" },
    { id: "b", date: "bad" },
    { id: "c", date: "2026-11-01" },
  ]);
  assert.deepEqual(sorted.map((v) => v.id), ["c", "a", "b"]);
});
