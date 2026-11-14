import { test } from "node:test";
import assert from "node:assert/strict";
import { levelRank, newestOpenFlagAt, sortPatients } from "../js/lib/sort.js";

const p = (id, displayName, flagLevel) => ({ id, displayName, flagLevel });

test("red comes before amber, which comes before green", () => {
  const sorted = sortPatients([p("g", "Aino", "green"), p("a", "Aino", "amber"), p("r", "Aino", "red")]);
  assert.deepEqual(sorted.map((x) => x.id), ["r", "a", "g"]);
});

test("within a level, the newest flag comes first and a Patient without flags last", () => {
  const sorted = sortPatients(
    [p("old", "Aino", "amber"), p("none", "Aino", "amber"), p("new", "Aino", "amber")],
    { old: 1_000, new: 2_000 },
  );
  assert.deepEqual(sorted.map((x) => x.id), ["new", "old", "none"]);
});

test("level wins over a newer flag", () => {
  const sorted = sortPatients([p("amber", "A", "amber"), p("red", "B", "red")], { amber: 9_000, red: 1_000 });
  assert.deepEqual(sorted.map((x) => x.id), ["red", "amber"]);
});

test("then by name, then by id, so equal Patients keep a stable place", () => {
  const sorted = sortPatients([p("2", "Sara", "green"), p("3", "Aino", "green"), p("1", "Sara", "green")]);
  assert.deepEqual(sorted.map((x) => x.id), ["3", "1", "2"]);
});

test("an unknown or missing level sorts with green and never above a real flag", () => {
  assert.equal(levelRank(undefined), levelRank("green"));
  assert.equal(levelRank("purple"), levelRank("green"));
  const sorted = sortPatients([p("x", "A", undefined), p("a", "B", "amber")]);
  assert.deepEqual(sorted.map((x) => x.id), ["a", "x"]);
});

test("sorting returns a new array and leaves the input alone", () => {
  const input = [p("g", "A", "green"), p("r", "B", "red")];
  const sorted = sortPatients(input);
  assert.notEqual(sorted, input);
  assert.deepEqual(input.map((x) => x.id), ["g", "r"]);
});

test("the newest flag is the newest one not yet cleared", () => {
  const flags = [
    { raisedAtMillis: 300, clearedAtMillis: 400 },
    { raisedAtMillis: 200, clearedAtMillis: null },
    { raisedAtMillis: 100, clearedAtMillis: null },
  ];
  assert.equal(newestOpenFlagAt(flags), 200);
  assert.equal(newestOpenFlagAt([{ raisedAtMillis: 5, clearedAtMillis: 6 }]), null);
  assert.equal(newestOpenFlagAt([]), null);
});
