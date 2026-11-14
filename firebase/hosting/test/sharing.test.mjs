import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SHARING_COPY,
  clinicianListFilters,
  sharingMessage,
  sharingStateFromError,
  sharingStateFromSnapshot,
} from "../js/lib/sharing.js";

test("the Patient list asks only for this Clinician's Patients who share", () => {
  assert.deepEqual(clinicianListFilters("clinician@example.com"), [
    ["clinicianEmail", "==", "clinician@example.com"],
    ["sharingConsent", "==", "granted"],
  ]);
});

test("a Patient who shares is shown", () => {
  const data = { displayName: "Alice", sharingConsent: "granted" };
  assert.deepEqual(sharingStateFromSnapshot({ exists: true, data }), { status: "ok", patient: data });
});

test("a Patient who declined or has not decided shows the withdrawn state, not their data", () => {
  for (const sharingConsent of ["declined", "undecided", undefined]) {
    assert.deepEqual(sharingStateFromSnapshot({ exists: true, data: { displayName: "Demo", sharingConsent } }), {
      status: "withdrawn",
    });
  }
});

test("a missing record is an error", () => {
  assert.deepEqual(sharingStateFromSnapshot({ exists: false }), { status: "error" });
  assert.deepEqual(sharingStateFromSnapshot(null), { status: "error" });
});

test("permission-denied on an open listener means sharing was withdrawn, not a failure", () => {
  assert.deepEqual(sharingStateFromError({ code: "permission-denied", message: "Missing or insufficient permissions." }), {
    status: "withdrawn",
  });
  assert.deepEqual(sharingStateFromError({ code: "firestore/permission-denied" }), { status: "withdrawn" });
});

test("any other error is an error", () => {
  for (const error of [{ code: "unavailable" }, { code: "internal" }, {}, null]) {
    assert.deepEqual(sharingStateFromError(error), { status: "error" });
  }
});

test("each state has vetted copy, and the withdrawn copy is calm and never shows the raw error", () => {
  assert.equal(sharingMessage({ status: "ok", patient: {} }), null);
  assert.equal(sharingMessage({ status: "withdrawn" }), SHARING_COPY.withdrawn);
  assert.equal(sharingMessage({ status: "error" }), SHARING_COPY.error);
  assert.doesNotMatch(SHARING_COPY.withdrawn, /error|denied|permission|failed/i);
});
