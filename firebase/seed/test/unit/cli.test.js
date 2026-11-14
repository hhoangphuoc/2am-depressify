import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_EMULATOR_HOST, DEFAULT_PROJECT, parseCommand } from "../../src/cli.js";

test("by default the seed targets the local emulator of the demo project", () => {
  const command = parseCommand([], {});
  assert.equal(command.projectId, DEFAULT_PROJECT);
  assert.equal(command.emulatorHost, DEFAULT_EMULATOR_HOST);
  assert.equal(command.clinicianEmail, "clinician@example.com");
  assert.equal(command.today, undefined);
});

test("the emulator host and project from emulators:exec are honoured", () => {
  const command = parseCommand([], { FIRESTORE_EMULATOR_HOST: "127.0.0.1:9180", GCLOUD_PROJECT: "demo-other" });
  assert.equal(command.emulatorHost, "127.0.0.1:9180");
  assert.equal(command.projectId, "demo-other");
});

test("a real project needs --project, and then no emulator is used", () => {
  const command = parseCommand(["--project", "twoam-prod"], {});
  assert.equal(command.projectId, "twoam-prod");
  assert.equal(command.emulatorHost, null);
});

test("--project with the emulator running still writes to the emulator", () => {
  const command = parseCommand(["--project", "twoam-prod"], { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" });
  assert.equal(command.emulatorHost, "127.0.0.1:8080");
});

test("a demo- project is refused outside the emulator", () => {
  assert.throws(() => parseCommand(["--project", "demo-twoam"], {}), /emulator-only/);
});

test("--today and --seed are validated", () => {
  assert.equal(parseCommand(["--today", "2026-11-14", "--seed", "7"], {}).today, "2026-11-14");
  assert.equal(parseCommand(["--seed", "7"], {}).seed, 7);
  assert.throws(() => parseCommand(["--today", "14.11.2026"], {}), /yyyy-MM-dd/);
  assert.throws(() => parseCommand(["--today", "2026-02-30"], {}), /yyyy-MM-dd/);
  assert.throws(() => parseCommand(["--seed", "abc"], {}), /integer/);
  assert.throws(() => parseCommand(["--unknown"], {}));
});

test("CLINICIAN_EMAIL overrides the demo Clinician", () => {
  assert.equal(parseCommand([], { CLINICIAN_EMAIL: "other@example.com" }).clinicianEmail, "other@example.com");
});
