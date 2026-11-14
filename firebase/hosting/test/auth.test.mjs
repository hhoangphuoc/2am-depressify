import { test } from "node:test";
import assert from "node:assert/strict";
import { signInErrorMessage, emulatorHostFor } from "../js/lib/auth.js";

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
