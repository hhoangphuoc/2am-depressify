// The live demo Patient command's arguments and target: the same rules as the seed, plus the
// Patient's email and the Auth emulator.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_AUTH_EMULATOR_HOST, DEFAULT_EMULATOR_HOST, DEFAULT_PROJECT, parseLivePatientCommand } from "../../src/cli.js";
import { LIVE_DEFAULT_DISPLAY_NAME } from "../../src/live-patient.js";

const PATIENT = "patient.test@example.com";

test("by default it targets both emulators of the demo project, with the placeholder Clinician", () => {
  const command = parseLivePatientCommand(["--email", PATIENT], {});
  assert.equal(command.projectId, DEFAULT_PROJECT);
  assert.equal(command.emulatorHost, DEFAULT_EMULATOR_HOST);
  assert.equal(command.authEmulatorHost, DEFAULT_AUTH_EMULATOR_HOST);
  assert.equal(command.clinicianEmail, "clinician@example.com");
  assert.equal(command.displayName, LIVE_DEFAULT_DISPLAY_NAME);
  assert.equal(command.reset, false);
  assert.equal(command.today, undefined);
});

test("honours the emulators from emulators:exec", () => {
  const command = parseLivePatientCommand(["--email", PATIENT], {
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:9180",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9199",
    GCLOUD_PROJECT: "demo-other",
  });
  assert.equal(command.emulatorHost, "127.0.0.1:9180");
  assert.equal(command.authEmulatorHost, "127.0.0.1:9199");
  assert.equal(command.projectId, "demo-other");
});

test("needs --email, a valid one, trimmed and lower-cased; the error never echoes it", () => {
  assert.throws(() => parseLivePatientCommand([], {}), /--email <patient email> is required/);
  assert.throws(() => parseLivePatientCommand(["--email", "secret-name"], {}), (error) => {
    assert.match(String(error), /--email must be an email address/);
    assert.doesNotMatch(String(error), /secret-name/);
    return true;
  });
  assert.equal(parseLivePatientCommand(["--email", "  Patient.Test@Example.COM "], {}).email, PATIENT);
});

test("the Patient and the Clinician must be different accounts", () => {
  assert.throws(() => parseLivePatientCommand(["--email", "clinician@example.com"], {}), /must not be the Clinician/);
});

test("a real project needs a real Clinician, and no Auth emulator in the environment", () => {
  assert.throws(() => parseLivePatientCommand(["--email", PATIENT, "--project", "twoam-prod"], {}), /needs the Clinician's email/);
  assert.throws(
    () => parseLivePatientCommand(["--email", PATIENT, "--project", "twoam-prod", "--clinician", "clinician@example.com"], {}),
    /emulator placeholder/,
  );
  const real = parseLivePatientCommand(["--email", PATIENT, "--project", "twoam-prod", "--clinician", "dr.real@example.org"], {});
  assert.equal(real.emulatorHost, null);
  assert.equal(real.authEmulatorHost, null);
  assert.equal(real.clinicianEmail, "dr.real@example.org");
  // Firestore real but Auth on an emulator (or the reverse) is never what was meant.
  assert.throws(
    () => parseLivePatientCommand(["--email", PATIENT, "--project", "twoam-prod", "--clinician", "dr.real@example.org"], { FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" }),
    /Auth emulator/,
  );
});

test("a demo- project is refused outside the emulator", () => {
  assert.throws(() => parseLivePatientCommand(["--email", PATIENT, "--project", "demo-twoam"], {}), /emulator-only/);
});

test("--display-name, --today, --seed and --reset", () => {
  const command = parseLivePatientCommand(
    ["--email", PATIENT, "--display-name", " Robin ", "--today", "2026-11-14", "--seed", "7", "--reset"],
    {},
  );
  assert.equal(command.displayName, "Robin");
  assert.equal(command.today, "2026-11-14");
  assert.equal(command.seed, 7);
  assert.equal(command.reset, true);
  assert.throws(() => parseLivePatientCommand(["--email", PATIENT, "--display-name", "  "], {}), /--display-name/);
  assert.throws(() => parseLivePatientCommand(["--email", PATIENT, "--today", "14.11.2026"], {}), /yyyy-MM-dd/);
  assert.throws(() => parseLivePatientCommand(["--email", PATIENT, "--seed", "x"], {}), /integer/);
  assert.throws(() => parseLivePatientCommand(["--email", PATIENT, "--unknown"], {}));
});

test("--help needs nothing else", () => {
  assert.equal(parseLivePatientCommand(["--help"], {}).help, true);
  assert.equal(parseLivePatientCommand(["--help", "--project", "twoam-prod"], {}).help, true);
});
