import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTAKE_MAX_WORDS,
  REPORT_MAX_CHARS,
  countWords,
  highlightsProblem,
  initialIntakeState,
  intakeErrorMessage,
  intakeReducer,
  reportProblem,
  wordCountLabel,
} from "../js/lib/intake.js";

const words = (n) => Array.from({ length: n }, (_, i) => `w${i + 1}`).join(" ");
const run = (state, ...actions) => actions.reduce(intakeReducer, state);
const REPORT = "Fictional report. Likes early walks.";
const HIGHLIGHTS = "- Likes early walks.";

// ---- Words and limits --------------------------------------------------------------------------

test("words are counted across spaces and lines, and a bullet is not a word", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords(" \n\t "), 0);
  assert.equal(countWords("- Likes  early\nwalks — 2 dogs"), 5);
  assert.equal(wordCountLabel("- one two"), `2 of ${INTAKE_MAX_WORDS} words`);
});

test("an empty or whitespace report is refused before any call", () => {
  assert.equal(reportProblem(""), "Paste the report text first.");
  assert.equal(reportProblem("   \n\t"), "Paste the report text first.");
  assert.equal(reportProblem(undefined), "Paste the report text first.");
  assert.equal(reportProblem(REPORT), null);
});

test("a report over the length limit is refused", () => {
  assert.match(reportProblem("x".repeat(REPORT_MAX_CHARS + 1)), /too long/);
  assert.equal(reportProblem("x".repeat(REPORT_MAX_CHARS)), null);
});

test("highlights must be between one and 120 words", () => {
  assert.match(highlightsProblem(" "), /empty/);
  assert.equal(highlightsProblem(words(INTAKE_MAX_WORDS)), null);
  assert.match(highlightsProblem(words(INTAKE_MAX_WORDS + 3)), /Remove 3 to save/);
});

test("error copy never shows the raw error text", () => {
  const raw = { code: "functions/internal", message: "secret stack trace with report text" };
  for (const stage of ["extract", "save"]) {
    assert.doesNotMatch(intakeErrorMessage(stage, raw), /secret|stack|report text/);
  }
  assert.match(intakeErrorMessage("extract", { code: "functions/unavailable" }), /Could not extract highlights/);
  assert.match(intakeErrorMessage("save", { code: "functions/unavailable" }), /Could not save/);
  assert.match(intakeErrorMessage("save", { code: "functions/permission-denied" }), /Only this Patient's Clinician/);
  assert.match(intakeErrorMessage("extract", undefined), /Check your connection/);
});

// ---- State machine -----------------------------------------------------------------------------

test("starts showing the saved Intake", () => {
  assert.deepEqual(initialIntakeState(), { mode: "view", report: "", draft: "", trimmed: false, error: null, failed: null });
});

test("an empty report stays on the form with a message and does not start a call", () => {
  const state = run(initialIntakeState(), { type: "start" }, { type: "editReport", text: "  " }, { type: "extract" });
  assert.equal(state.mode, "compose");
  assert.equal(state.error, "Paste the report text first.");
});

test("paste, extract, review, edit and save, then back to the saved view with nothing held", () => {
  let state = run(initialIntakeState(), { type: "start" }, { type: "editReport", text: REPORT }, { type: "extract" });
  assert.equal(state.mode, "extracting");

  state = run(state, { type: "extractSucceeded", highlights: HIGHLIGHTS, trimmed: false });
  assert.equal(state.mode, "review");
  assert.equal(state.draft, HIGHLIGHTS);

  state = run(state, { type: "editDraft", text: `${HIGHLIGHTS}\n- Has a dog.` }, { type: "save" });
  assert.equal(state.mode, "saving");
  assert.equal(state.draft, `${HIGHLIGHTS}\n- Has a dog.`);

  state = run(state, { type: "saveSucceeded" });
  assert.deepEqual(state, initialIntakeState());
});

test("a failed extraction keeps the report and offers a retry", () => {
  const failed = run(
    initialIntakeState(),
    { type: "start" },
    { type: "editReport", text: REPORT },
    { type: "extract" },
    { type: "extractFailed", message: "Could not extract highlights." },
  );
  assert.equal(failed.mode, "compose");
  assert.equal(failed.report, REPORT);
  assert.equal(failed.failed, "extract");
  assert.equal(failed.error, "Could not extract highlights.");

  const retried = run(failed, { type: "extract" });
  assert.equal(retried.mode, "extracting");
  assert.equal(retried.report, REPORT);
  assert.equal(retried.error, null);
});

test("a failed save keeps the edited highlights and offers a retry", () => {
  const edited = `${HIGHLIGHTS}\n- Edited by the Clinician.`;
  const failed = run(
    initialIntakeState(),
    { type: "start" },
    { type: "editReport", text: REPORT },
    { type: "extract" },
    { type: "extractSucceeded", highlights: HIGHLIGHTS },
    { type: "editDraft", text: edited },
    { type: "save" },
    { type: "saveFailed", message: "Could not save the highlights." },
  );
  assert.equal(failed.mode, "review");
  assert.equal(failed.draft, edited);
  assert.equal(failed.report, REPORT);
  assert.equal(failed.failed, "save");

  const retried = run(failed, { type: "save" });
  assert.equal(retried.mode, "saving");
  assert.equal(retried.draft, edited);
});

test("over-limit highlights cannot be saved", () => {
  const state = run(
    initialIntakeState(),
    { type: "start" },
    { type: "editReport", text: REPORT },
    { type: "extract" },
    { type: "extractSucceeded", highlights: HIGHLIGHTS },
    { type: "editDraft", text: words(INTAKE_MAX_WORDS + 1) },
    { type: "save" },
  );
  assert.equal(state.mode, "review");
  assert.match(state.error, /at most 120 words/);
});

test("trimmed extraction is remembered for the review", () => {
  const state = run(
    initialIntakeState(),
    { type: "start" },
    { type: "editReport", text: REPORT },
    { type: "extract" },
    { type: "extractSucceeded", highlights: words(120), trimmed: true },
  );
  assert.equal(state.trimmed, true);
});

test("back to the report keeps the report and drops the draft", () => {
  const state = run(
    initialIntakeState(),
    { type: "start" },
    { type: "editReport", text: REPORT },
    { type: "extract" },
    { type: "extractSucceeded", highlights: HIGHLIGHTS },
    { type: "backToReport" },
  );
  assert.equal(state.mode, "compose");
  assert.equal(state.report, REPORT);
  assert.equal(state.draft, "");
});

test("edits and cancel are ignored while a call is in flight", () => {
  const extracting = run(initialIntakeState(), { type: "start" }, { type: "editReport", text: REPORT }, { type: "extract" });
  assert.equal(run(extracting, { type: "editReport", text: "changed" }), extracting);
  assert.equal(run(extracting, { type: "cancel" }), extracting);
  assert.equal(run(extracting, { type: "extract" }), extracting);
});

test("cancel drops the report and the draft", () => {
  const state = run(initialIntakeState(), { type: "start" }, { type: "editReport", text: REPORT }, { type: "cancel" });
  assert.deepEqual(state, initialIntakeState());
});

test("a late result for a call that is no longer in flight is ignored", () => {
  const view = initialIntakeState();
  assert.equal(run(view, { type: "extractSucceeded", highlights: HIGHLIGHTS }), view);
  assert.equal(run(view, { type: "saveFailed", message: "x" }), view);
});
