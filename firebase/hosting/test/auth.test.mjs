import { test } from "node:test";
import assert from "node:assert/strict";
import { clinicianAccessMessage, signInErrorMessage, emulatorHostFor } from "../js/lib/auth.js";

test("wrong password and unknown account give the same message", () => {
  const codes = [
    "auth/wrong-password",
    "auth/user-not-found",
    "auth/invalid-credential",
    "auth/invalid-login-credentials",
    "auth/invalid-email",
    "auth/user-disabled",
  ];
  const messages = new Set(codes.map((code) => signInErrorMessage({ code })));
  assert.equal(messages.size, 1);
  const [message] = messages;
  assert.doesNotMatch(message, /exist|not found|no account|unknown user|registered/i);
});

test("an unexpected error never shows the raw error text", () => {
  const message = signInErrorMessage({ code: "auth/internal-error", message: "INTERNAL: stack trace here" });
  assert.doesNotMatch(message, /INTERNAL|stack/);
  assert.equal(message, signInErrorMessage({ code: "auth/wrong-password" }));
});

test("a network failure says so, because that does not reveal anything about the account", () => {
  assert.match(signInErrorMessage({ code: "auth/network-request-failed" }), /connection/i);
});

test("the dashboard talks to the emulators only when served locally", () => {
  assert.equal(emulatorHostFor("localhost"), "127.0.0.1");
  assert.equal(emulatorHostFor("127.0.0.1"), "127.0.0.1");
  assert.equal(emulatorHostFor("twoam.web.app"), null);
});

test("a Clinician's account, with the claim and a verified email, may use the dashboard", () => {
  assert.equal(clinicianAccessMessage({ role: "clinician", email_verified: true, email: "clinician@example.com" }), null);
});

test("an account without the claim or a verified email is told it isn't set up as a Clinician yet", () => {
  const refused = [
    { email_verified: true, email: "clinician@example.com" }, // a Patient's account, or before allow-clinician
    { role: "clinician", email_verified: false },
    { role: "clinician" },
    { role: "admin", email_verified: true },
    {},
    null,
    undefined,
  ];
  for (const claims of refused) {
    assert.match(clinicianAccessMessage(claims) ?? "", /isn't set up as a Clinician yet/);
  }
});

test("the message is not a credentials error, so it never reads as a wrong password", () => {
  assert.notEqual(clinicianAccessMessage({}), signInErrorMessage({ code: "auth/wrong-password" }));
});
