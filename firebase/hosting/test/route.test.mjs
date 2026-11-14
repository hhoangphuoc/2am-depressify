import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoute, patientHref } from "../js/lib/route.js";

test("no hash or an unknown hash is the Patient list", () => {
  for (const hash of ["", "#", "#/", "#/nothing", "#/patient/", "#/patient/a/b"]) {
    assert.deepEqual(parseRoute(hash), { name: "list" }, hash);
  }
});

test("a Patient link opens that Patient's page", () => {
  assert.deepEqual(parseRoute("#/patient/abc123"), { name: "patient", patientId: "abc123" });
  assert.deepEqual(parseRoute("#/patient/abc123/"), { name: "patient", patientId: "abc123" });
});

test("ids round-trip through the link", () => {
  for (const id of ["Xy9-_z", "demo declining", "ä"]) {
    assert.deepEqual(parseRoute(patientHref(id)), { name: "patient", patientId: id });
  }
});

test("an id that decodes to a path or is malformed falls back to the list", () => {
  assert.deepEqual(parseRoute("#/patient/a%2Fb"), { name: "list" });
  assert.deepEqual(parseRoute("#/patient/%E0%A4%A"), { name: "list" });
  assert.deepEqual(parseRoute("#/patient/%20"), { name: "list" });
});
