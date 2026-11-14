import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ALLOW_USAGE, DEFAULT_AUTH_EMULATOR_HOST, DEFAULT_EMULATOR_HOST, DEFAULT_PROJECT, parseAllowCommand, parseCommand } from "../../src/cli.js";

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
  const command = parseCommand(["--project", "twoam-prod", "--clinician", "dr.real@example.org"], {});
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

test("CLINICIAN_EMAIL overrides the placeholder Clinician", () => {
  assert.equal(parseCommand([], { CLINICIAN_EMAIL: "other@example.com" }).clinicianEmail, "other@example.com");
});

test("--clinician gives the Clinician, and wins over CLINICIAN_EMAIL", () => {
  assert.equal(parseCommand(["--clinician", "flag@example.com"], {}).clinicianEmail, "flag@example.com");
  const both = parseCommand(["--clinician", "flag@example.com"], { CLINICIAN_EMAIL: "env@example.com" });
  assert.equal(both.clinicianEmail, "flag@example.com");
});

test("the Clinician's email is trimmed and lower-cased, as the sign-in token carries it", () => {
  assert.equal(parseCommand(["--clinician", "  Dr.Real@Example.ORG "], {}).clinicianEmail, "dr.real@example.org");
  assert.equal(parseCommand([], { CLINICIAN_EMAIL: "Env@Example.com" }).clinicianEmail, "env@example.com");
});

test("a Clinician that is not an email address is refused, naming where it came from", () => {
  assert.throws(() => parseCommand(["--clinician", "nobody"], {}), /--clinician must be an email address/);
  assert.throws(() => parseCommand(["--clinician", "a b@example.com"], {}), /--clinician must be an email address/);
  assert.throws(() => parseCommand(["--clinician", ""], {}), /--clinician must be an email address/);
  assert.throws(() => parseCommand([], { CLINICIAN_EMAIL: "x@y" }), /CLINICIAN_EMAIL must be an email address/);
});

test("a real project is not seeded without a Clinician: no fallback to the placeholder", () => {
  assert.throws(() => parseCommand(["--project", "twoam-prod"], {}), /needs the Clinician's email: pass --clinician <email> or set CLINICIAN_EMAIL/);
  // An empty CLINICIAN_EMAIL counts as unset.
  assert.throws(() => parseCommand(["--project", "twoam-prod"], { CLINICIAN_EMAIL: "" }), /needs the Clinician's email/);
});

test("a real project is not seeded with the placeholder, given either way", () => {
  assert.throws(() => parseCommand(["--project", "twoam-prod", "--clinician", "clinician@example.com"], {}), /emulator placeholder/);
  assert.throws(() => parseCommand(["--project", "twoam-prod"], { CLINICIAN_EMAIL: "Clinician@Example.com" }), /emulator placeholder/);
});

test("a real project with CLINICIAN_EMAIL set is seeded for that Clinician", () => {
  const command = parseCommand(["--project", "twoam-prod"], { CLINICIAN_EMAIL: "dr.real@example.org" });
  assert.equal(command.clinicianEmail, "dr.real@example.org");
  assert.equal(command.emulatorHost, null);
});

test("--project with the emulator running may use the placeholder, since it is the emulator", () => {
  const command = parseCommand(["--project", "twoam-prod"], { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" });
  assert.equal(command.clinicianEmail, "clinician@example.com");
});

test("--help works for a real project without a Clinician", () => {
  assert.equal(parseCommand(["--project", "twoam-prod", "--help"], {}).help, true);
});

describe("allow-clinician", () => {
  test("allows the given email in the emulator by default", () => {
    const command = parseAllowCommand(["--email", "Clinician@Example.com"], {});
    assert.equal(command.email, "clinician@example.com");
    assert.equal(command.projectId, DEFAULT_PROJECT);
    assert.equal(command.emulatorHost, DEFAULT_EMULATOR_HOST);
  });

  test("targets a real project with --project, like the seed", () => {
    const command = parseAllowCommand(["--email", "dr.real@example.org", "--project", "twoam-prod"], {});
    assert.equal(command.projectId, "twoam-prod");
    assert.equal(command.emulatorHost, null);
    assert.equal(command.email, "dr.real@example.org");
  });

  test("honours the emulator from emulators:exec", () => {
    const command = parseAllowCommand(["--email", "a@example.com"], { FIRESTORE_EMULATOR_HOST: "127.0.0.1:9180", GCLOUD_PROJECT: "demo-other" });
    assert.equal(command.emulatorHost, "127.0.0.1:9180");
    assert.equal(command.projectId, "demo-other");
  });

  test("needs --email, and a valid one", () => {
    assert.throws(() => parseAllowCommand([], {}), /--email <email> is required/);
    assert.throws(() => parseAllowCommand(["--email", "nobody"], {}), /--email must be an email address/);
    assert.throws(() => parseAllowCommand(["--email", "a@example.com", "--unknown"], {}));
  });

  test("refuses a demo- project outside the emulator, and the placeholder on a real project", () => {
    assert.throws(() => parseAllowCommand(["--email", "a@example.com", "--project", "demo-twoam"], {}), /emulator-only/);
    assert.throws(() => parseAllowCommand(["--email", "clinician@example.com", "--project", "twoam-prod"], {}), /emulator placeholder/);
  });

  test("--help needs no email", () => {
    assert.equal(parseAllowCommand(["--help"], {}).help, true);
  });

  test("takes --uid, the console account the admin vouches for, and none by default", () => {
    assert.equal(parseAllowCommand(["--email", "a@example.com", "--uid", "abc123"], {}).uid, "abc123");
    assert.equal(parseAllowCommand(["--email", "a@example.com"], {}).uid, null);
  });

  test("uses the Auth emulator whenever it uses the Firestore emulator, and neither for a real project", () => {
    assert.equal(parseAllowCommand(["--email", "a@example.com"], {}).authEmulatorHost, DEFAULT_AUTH_EMULATOR_HOST);
    assert.equal(
      parseAllowCommand(["--email", "a@example.com"], { FIRESTORE_EMULATOR_HOST: "127.0.0.1:9180", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9199" }).authEmulatorHost,
      "127.0.0.1:9199",
    );
    // --project while emulators:exec runs: still the emulators, as for Firestore.
    assert.equal(
      parseAllowCommand(["--email", "a@example.com", "--project", "twoam-prod"], { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }).authEmulatorHost,
      DEFAULT_AUTH_EMULATOR_HOST,
    );
    // A real project: no Auth emulator, even if one is set in the environment.
    assert.equal(
      parseAllowCommand(["--email", "a@example.com", "--project", "twoam-prod"], { FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" }).authEmulatorHost,
      null,
    );
  });

  test("the usage says it sets the Clinician claim and how the Clinician picks it up", () => {
    assert.match(ALLOW_USAGE, /role "clinician"/);
    assert.match(ALLOW_USAGE, /signs out and in again/);
  });
});
