import { test } from "node:test";
import assert from "node:assert/strict";
import {
  digestButtonLabel,
  digestCoverage,
  digestErrorMessage,
  digestGenerated,
  digestReducer,
  digestSource,
  digestStatus,
  initialDigestState,
  isGenerating,
} from "../js/lib/digest.js";

const run = (state, ...actions) => actions.reduce(digestReducer, state);

/** @type {import("../js/lib/contract.js").Digest} */
const LAST_WEEK = {
  isoWeek: "2026-W45",
  weekStart: "2026-11-02",
  weekEnd: "2026-11-08",
  summaryCount: 5,
  text: "Mood was steady.",
  generatedAtMillis: Date.parse("2026-11-09T05:00:00Z"),
};
const THIS_WEEK = {
  isoWeek: "2026-W46",
  weekStart: "2026-11-09",
  weekEnd: "2026-11-14",
  summaryCount: 4,
  text: "Mood was rated lower.",
  generatedAtMillis: Date.parse("2026-11-14T10:32:00Z"),
};

// ---- State machine ------------------------------------------------------------------------------

test("starts idle with nothing loaded", () => {
  const state = initialDigestState();
  assert.equal(state.phase, "idle");
  assert.equal(state.digest, null);
  assert.equal(state.loaded, false);
  assert.equal(digestButtonLabel(state), "Generate now");
});

test("shows the latest Digest from the listener", () => {
  const state = run(initialDigestState(), { type: "loaded", digest: LAST_WEEK });
  assert.equal(state.loaded, true);
  assert.deepEqual(state.digest, LAST_WEEK);
  assert.equal(digestStatus(state), "");
});

test("Generate now: idle → generating, with the button busy", () => {
  const state = run(initialDigestState(), { type: "loaded", digest: LAST_WEEK }, { type: "generate" });
  assert.equal(state.phase, "generating");
  assert.equal(isGenerating(state), true);
  assert.equal(digestButtonLabel(state), "Generating…");
  assert.deepEqual(state.digest, LAST_WEEK, "the last Digest stays visible while generating");
});

test("cannot be triggered twice at once", () => {
  const generating = run(initialDigestState(), { type: "generate" });
  assert.equal(digestReducer(generating, { type: "generate" }), generating, "a second press changes nothing");
});

test("success → regenerated, showing the new Digest at once", () => {
  const state = run(
    initialDigestState(),
    { type: "loaded", digest: LAST_WEEK },
    { type: "generate" },
    { type: "generateSucceeded", digest: THIS_WEEK },
  );
  assert.equal(state.phase, "regenerated");
  assert.deepEqual(state.digest, THIS_WEEK);
  assert.equal(digestStatus(state), "Digest regenerated.");
  assert.equal(digestButtonLabel(state), "Generate now");
});

test("the first Digest for a Patient says generated, not regenerated", () => {
  const state = run(initialDigestState(), { type: "loaded", digest: null }, { type: "generate" }, { type: "generateSucceeded", digest: THIS_WEEK });
  assert.equal(digestStatus(state), "Digest generated.");
});

test("failure → failed with a retry, keeping the last Digest", () => {
  const failed = run(
    initialDigestState(),
    { type: "loaded", digest: LAST_WEEK },
    { type: "generate" },
    { type: "generateFailed", message: "Could not generate the Digest." },
  );
  assert.equal(failed.phase, "failed");
  assert.equal(digestStatus(failed), "Could not generate the Digest.");
  assert.equal(digestButtonLabel(failed), "Try again");
  assert.deepEqual(failed.digest, LAST_WEEK);

  const retrying = digestReducer(failed, { type: "generate" });
  assert.equal(retrying.phase, "generating");
  assert.equal(retrying.error, null);
  const done = digestReducer(retrying, { type: "generateSucceeded", digest: THIS_WEEK });
  assert.equal(done.phase, "regenerated");
});

test("results that arrive when nothing is generating are ignored", () => {
  const idle = run(initialDigestState(), { type: "loaded", digest: LAST_WEEK });
  assert.equal(digestReducer(idle, { type: "generateSucceeded", digest: THIS_WEEK }), idle);
  assert.equal(digestReducer(idle, { type: "generateFailed", message: "x" }), idle);
});

test("a listener update while generating keeps the generating state", () => {
  const state = run(initialDigestState(), { type: "generate" }, { type: "loaded", digest: LAST_WEEK });
  assert.equal(state.phase, "generating");
  assert.deepEqual(state.digest, LAST_WEEK);
});

test("a failed load is shown as a load error, not a Digest", () => {
  const state = run(initialDigestState(), { type: "loadFailed" });
  assert.equal(state.loaded, true);
  assert.equal(state.digest, null);
  assert.equal(state.loadFailed, true);
  assert.match(digestStatus(state), /Could not load/);
});

test("unknown actions change nothing", () => {
  const state = initialDigestState();
  assert.equal(digestReducer(state, { type: "nonsense" }), state);
});

// ---- Copy -------------------------------------------------------------------------------------

test("states the dates covered", () => {
  assert.equal(digestCoverage(LAST_WEEK), "Monday 2 November to Sunday 8 November 2026");
  assert.equal(digestCoverage(THIS_WEEK), "Monday 9 November to Saturday 14 November 2026 (the week so far)");
  assert.equal(
    digestCoverage({ ...LAST_WEEK, weekStart: "2026-12-28", weekEnd: "2027-01-03" }),
    "Monday 28 December 2026 to Sunday 3 January 2027",
  );
  assert.equal(digestCoverage({ ...LAST_WEEK, weekStart: "2026-11-16", weekEnd: "2026-11-16" }), "Monday 16 November 2026 (the week so far)");
});

test("states how many Summaries it drew on", () => {
  assert.equal(digestSource({ summaryCount: 5 }), "Drawn from 5 Summaries");
  assert.equal(digestSource({ summaryCount: 1 }), "Drawn from 1 Summary");
  assert.equal(digestSource({ summaryCount: 0 }), "No Check-ins in these dates");
});

test("states when it was generated, in Helsinki time", () => {
  assert.equal(digestGenerated(THIS_WEEK.generatedAtMillis), "Generated 14 November 2026 at 12:32");
  // Summer time: 09:05 UTC is 12:05 in Helsinki.
  assert.equal(digestGenerated(Date.parse("2026-07-06T09:05:00Z")), "Generated 6 July 2026 at 12:05");
});

test("failure copy is vetted and never the raw error", () => {
  const raw = { code: "functions/unavailable", message: "Request failed for input: secret text" };
  assert.doesNotMatch(digestErrorMessage(raw), /secret text/);
  assert.match(digestErrorMessage(raw), /try again/i);
  assert.match(digestErrorMessage({ code: "functions/permission-denied" }), /Clinician/);
  assert.match(digestErrorMessage({ code: "functions/unauthenticated" }), /Sign in/);
  assert.match(digestErrorMessage(undefined), /try again/i);
});

test("no copy says diagnosis, treatment or risk score", () => {
  const states = [
    initialDigestState(),
    run(initialDigestState(), { type: "generate" }),
    run(initialDigestState(), { type: "generate" }, { type: "generateFailed", message: digestErrorMessage({}) }),
    run(initialDigestState(), { type: "generate" }, { type: "generateSucceeded", digest: THIS_WEEK }),
    run(initialDigestState(), { type: "loadFailed" }),
  ];
  const copy = [
    ...states.flatMap((s) => [digestButtonLabel(s), digestStatus(s)]),
    digestCoverage(THIS_WEEK),
    digestSource(THIS_WEEK),
    digestSource({ summaryCount: 0 }),
    ...["permission-denied", "unauthenticated", "unavailable"].map((code) => digestErrorMessage({ code })),
  ].join("\n");
  assert.doesNotMatch(copy, /diagnos|treatment|therapy|risk score/i);
});
