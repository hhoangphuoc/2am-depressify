import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEFAULT_EMULATOR_HOST, DEFAULT_PROJECT, parseSilenceCommand } from "../../src/cli.js";
import { SILENCE_TEST_HOURS, runSilenceCheckCommand, silenceTestUpdate } from "../../src/silence-test.js";

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

/** @typedef {import("../../../functions/src/types.ts").PatientDoc} PatientDoc */

/**
 * @param {Partial<PatientDoc>} overrides
 * @returns {Partial<PatientDoc>}
 */
const live = (overrides = {}) => ({ sharingConsent: "granted", synthetic: false, lastSeenAtMillis: NOW - HOUR, ...overrides });

describe("silenceTestUpdate", () => {
  test("sets a live, sharing Patient's last sign of life to 25 hours ago, past the 24-hour rule", () => {
    assert.equal(SILENCE_TEST_HOURS, 25);
    assert.deepEqual(silenceTestUpdate(live(), NOW), { lastSeenAtMillis: NOW - 25 * HOUR });
  });

  test("works for a Patient never seen too", () => {
    assert.deepEqual(silenceTestUpdate(live({ lastSeenAtMillis: null }), NOW), { lastSeenAtMillis: NOW - 25 * HOUR });
  });

  test("refuses a missing record", () => {
    assert.throws(() => silenceTestUpdate(undefined, NOW), /No Patient record/);
  });

  test("refuses a Demo Patient: synthetic Patients are never silent", () => {
    assert.throws(() => silenceTestUpdate(live({ synthetic: true }), NOW), /synthetic.*never silent/);
  });

  test("refuses a Patient who is not sharing: the silence check skips them", () => {
    assert.throws(() => silenceTestUpdate(live({ sharingConsent: "declined" }), NOW), /not sharing/);
    assert.throws(() => silenceTestUpdate(live({ sharingConsent: "undecided" }), NOW), /not sharing/);
  });
});

describe("runSilenceCheckCommand", () => {
  test("names the Cloud Scheduler job of silenceCheck in its region", () => {
    assert.equal(
      runSilenceCheckCommand("my-project"),
      "gcloud scheduler jobs run firebase-schedule-silenceCheck-europe-west1 --location=europe-west1 --project=my-project",
    );
  });
});

describe("parseSilenceCommand", () => {
  test("targets the emulator by default and needs --patient", () => {
    const command = parseSilenceCommand(["--patient", "abc123"], {});
    assert.equal(command.patientId, "abc123");
    assert.equal(command.projectId, DEFAULT_PROJECT);
    assert.equal(command.emulatorHost, DEFAULT_EMULATOR_HOST);
    assert.throws(() => parseSilenceCommand([], {}), /--patient <id> is required/);
  });

  test("targets a real project with --project, like the seed", () => {
    const command = parseSilenceCommand(["--patient", "abc123", "--project", "twoam-prod"], {});
    assert.equal(command.projectId, "twoam-prod");
    assert.equal(command.emulatorHost, null);
  });

  test("refuses a Patient id that is not a single document id", () => {
    for (const bad of ["", "a/b", "..", ".", "__x__"]) {
      assert.throws(() => parseSilenceCommand(["--patient", bad], {}), /--patient must be a Patient id/);
    }
  });

  test("refuses a demo- project outside the emulator, and unknown options", () => {
    assert.throws(() => parseSilenceCommand(["--patient", "a", "--project", "demo-twoam"], {}), /emulator-only/);
    assert.throws(() => parseSilenceCommand(["--patient", "a", "--unknown"], {}));
  });

  test("--help needs no Patient", () => {
    assert.equal(parseSilenceCommand(["--help"], {}).help, true);
  });
});
