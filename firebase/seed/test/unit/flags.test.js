// The seed's copy of the phone's Signal rules for the Attention flag (core's `DailyJob`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { REASONS, THRESHOLDS, driftComposite } from "../../src/flags.js";

// The thresholds and reasons as fixtures/flags/signal-rules.json states them; core checks the same file.
const fixture = JSON.parse(readFileSync(new URL("../../../../fixtures/flags/signal-rules.json", import.meta.url), "utf8"));

test("the thresholds and reasons are the shared fixture's", () => {
  const t = fixture.thresholds;
  for (const key of ["sleepCollapseMinutes", "sleepCollapseOriented", "poorSleepOriented", "driftComposite", "driftMinSignals", "lowMoodAtMost"]) {
    assert.equal(THRESHOLDS[/** @type {keyof typeof THRESHOLDS} */ (key)], t[key], key);
  }
  for (const key of ["poorSleepNights", "lowMoodCheckIns", "driftDays"]) assert.equal(THRESHOLDS.runDays, t[key], key);
  for (const [key, reason] of Object.entries(REASONS)) assert.equal(reason, fixture.reasons[key], key);
});

test("a day counts toward drift only when several Signals make up its composite", () => {
  assert.equal(driftComposite({ sleepMinutes: -2 }), null);
  assert.equal(driftComposite({ sleepMinutes: -2, meanHeartRate: 3 }), null);
  assert.equal(driftComposite({ sleepMinutes: -2, steps: -1 }), -1.5);
});
