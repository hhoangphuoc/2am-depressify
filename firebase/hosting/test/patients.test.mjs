import { test } from "node:test";
import assert from "node:assert/strict";
import { toPatientRows } from "../js/lib/patients.js";

const doc = (id, data) => ({ id, data });

test("rows carry the id, name and flag level of each Patient", () => {
  const rows = toPatientRows([
    doc("p1", { displayName: "Live patient", clinicianEmail: "c@example.com", flagLevel: "green", flagReasons: [] }),
  ]);
  assert.deepEqual(rows, [
    { id: "p1", displayName: "Live patient", flagLevel: "green", flagReasons: [], lastCheckInAtMillis: null },
  ]);
});

test("rows are sorted by display name, then id, so a new Patient lands in a stable place", () => {
  const rows = toPatientRows([
    doc("b", { displayName: "Noor" }),
    doc("a", { displayName: "Aino" }),
    doc("c", { displayName: "Aino" }),
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["a", "c", "b"]);
});

test("missing fields fall back to honest defaults, never invented values", () => {
  const [row] = toPatientRows([doc("p9", {})]);
  assert.equal(row.displayName, "Unnamed patient");
  assert.equal(row.flagLevel, "green");
  assert.deepEqual(row.flagReasons, []);
  assert.equal(row.lastCheckInAtMillis, null);
});
