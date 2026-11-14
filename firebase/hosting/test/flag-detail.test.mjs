import { test } from "node:test";
import assert from "node:assert/strict";
import { asSentence, assessmentNote, flagDetailModel, flagSource, flagTimeText } from "../js/lib/flag-detail.js";

const TZ = "Europe/Helsinki";
const at = (iso) => Date.parse(iso);

test("a reason reads as a plain sentence", () => {
  assert.equal(asSentence("Slept under 3 hours last night."), "Slept under 3 hours last night.");
  assert.equal(asSentence("  phone has been quiet for a day "), "Phone has been quiet for a day.");
  assert.equal(asSentence("Is this right?"), "Is this right?");
  assert.equal(asSentence(""), "No reason recorded.");
  assert.equal(asSentence(null), "No reason recorded.");
});

test("each kind names where the flag came from", () => {
  assert.equal(flagSource("crisis"), "Raised during a Check-in");
  assert.equal(flagSource("decline"), "From the review after a Check-in");
  assert.equal(flagSource("unassessed"), "From the review after a Check-in");
  assert.equal(flagSource("sleep_collapse"), "From the phone's daily check");
  assert.equal(flagSource("low_mood"), "From the phone's daily check");
  assert.equal(flagSource("silent"), "From the hourly check for a quiet phone");
  assert.equal(flagSource("something_new"), "Source not recorded");
});

test("times show the date and the 24-hour clock", () => {
  assert.equal(flagTimeText(at("2026-11-14T05:10:00Z"), TZ), "14 Nov 2026, 07:10");
  assert.equal(flagTimeText(null, TZ), "Time not recorded");
});

test("the note says the latest reviewed Check-in could not be assessed, beside the last known level", () => {
  const failed = { startedAtMillis: 2, assessment: "unavailable" };
  assert.match(assessmentNote([{ startedAtMillis: 1, assessment: "assessed" }, failed]), /^Assessment unavailable/);
  // A silent Check-in after it was not reviewed, so it changes nothing.
  assert.match(assessmentNote([failed, { startedAtMillis: 3, assessment: null }]), /^Assessment unavailable/);
  // A later Check-in that was reviewed replaces it, whatever the order of the list.
  assert.equal(assessmentNote([{ startedAtMillis: 3, assessment: "assessed" }, failed]), null);
  assert.equal(assessmentNote([{ startedAtMillis: 3, assessment: "unassessed" }, failed]), null);
  assert.equal(assessmentNote([]), null);
  assert.equal(assessmentNote(null), null);
});

test("open flags come first by level then newest; cleared flags are history, newest cleared first", () => {
  const model = flagDetailModel(
    [
      { id: "a1", level: "amber", kind: "drift", reason: "Drift.", raisedAtMillis: at("2026-11-10T05:00:00Z"), clearedAtMillis: null },
      { id: "r1", level: "red", kind: "sleep_collapse", reason: "Slept under 3 hours last night.", raisedAtMillis: at("2026-11-09T05:00:00Z"), clearedAtMillis: null },
      { id: "old", level: "red", kind: "crisis", reason: "Crisis.", raisedAtMillis: at("2026-11-01T05:00:00Z"), clearedAtMillis: at("2026-11-02T08:00:00Z") },
      { id: "older", level: "amber", kind: "low_mood", reason: "Low.", raisedAtMillis: at("2026-10-01T05:00:00Z"), clearedAtMillis: at("2026-11-03T08:00:00Z") },
    ],
    { timeZone: TZ },
  );
  assert.deepEqual(model.open.map((f) => f.id), ["r1", "a1"]);
  assert.deepEqual(model.history.map((f) => f.id), ["older", "old"]);
  assert.deepEqual(model.open[0], {
    id: "r1",
    level: "red",
    levelWord: "Red",
    reason: "Slept under 3 hours last night.",
    source: "From the phone's daily check",
    raised: "Raised 9 Nov 2026, 07:00",
    cleared: null,
  });
  assert.equal(model.history[1].cleared, "Cleared 2 Nov 2026, 10:00");
});

test("no number ever reaches the detail: only level words, sentences, sources and times", () => {
  const model = flagDetailModel(
    [{ id: "x", level: "amber", kind: "decline", reason: "Check-ins sound flatter than usual.", raisedAtMillis: 0, clearedAtMillis: null, score: 0.91 }],
    { timeZone: TZ },
  );
  assert.equal(JSON.stringify(model).includes("0.91"), false);
});
