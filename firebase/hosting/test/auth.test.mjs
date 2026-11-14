import { test } from "node:test";
import assert from "node:assert/strict";
import { clinicianAccessMessage, clinicianAccessProblem, signInErrorMessage, emulatorHostFor } from "../js/lib/auth.js";

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

const CLINICIAN_CLAIMS = { role: "clinician", email_verified: true, email: "clinician@example.com" };

/**
 * A signed-in user whose cached ID token has `cached` and whose refreshed one has `fresh`; an
 * Error stands for a failed read. Records whether a refresh was asked for.
 */
function userWith(cached, fresh = cached) {
  const user = {
    refreshed: false,
    async getIdTokenResult(forceRefresh = false) {
      if (forceRefresh) user.refreshed = true;
      const claims = forceRefresh ? fresh : cached;
      if (claims instanceof Error) throw claims;
      return { claims };
    },
  };
  return user;
}
const authError = (code) => Object.assign(new Error(code), { code });

test("a Clinician whose cached token has the claim gets in without a refresh, so a reload works offline", async () => {
  const user = userWith(CLINICIAN_CLAIMS, authError("auth/network-request-failed"));
  assert.equal(await clinicianAccessProblem(user), null);
  assert.equal(user.refreshed, false);
});

test("a token without the claim is refreshed, so a claim the admin has just set counts", async () => {
  assert.equal(await clinicianAccessProblem(userWith({ email_verified: true }, CLINICIAN_CLAIMS)), null);
  assert.match((await clinicianAccessProblem(userWith({ email_verified: true }))) ?? "", /isn't set up as a Clinician yet/);
});

test("a lost connection never signs the Clinician out: the rules still decide what the account reads", async () => {
  assert.equal(await clinicianAccessProblem(userWith(authError("auth/network-request-failed"))), null);
  assert.equal(await clinicianAccessProblem(userWith({}, authError("auth/network-request-failed"))), null);
});

test("another failure to read the token is not reported as a wrong password", async () => {
  const message = (await clinicianAccessProblem(userWith({}, authError("auth/user-token-expired")))) ?? "";
  assert.notEqual(message, "");
  assert.notEqual(message, signInErrorMessage({ code: "auth/wrong-password" }));
  assert.doesNotMatch(message, /password/i);
});

