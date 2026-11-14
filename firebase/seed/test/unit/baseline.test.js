// The shared Baseline fixture (fixtures/baseline/baseline-cases.json), also read by core's Kotlin
// Baseline tests. If this fails after a change to the rule, change the fixture and core together.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  MIN_VALID_DAYS,
  SPREAD_FLOOR_ABSOLUTE,
  SPREAD_FLOOR_FRACTION,
  WINDOW_DAYS,
  compareWithBaseline,
  composite,
  oriented,
} from "../../src/baseline.js";

const fixture = JSON.parse(
  readFileSync(new URL("../../../../fixtures/baseline/baseline-cases.json", import.meta.url), "utf8"),
);

/** @param {number | null} actual @param {number | null} expected @param {string} name */
function assertClose(actual, expected, name) {
  if (expected === null) {
    assert.equal(actual, null, `${name}: expected null, got ${actual}`);
    return;
  }
  assert.equal(typeof actual, "number", `${name}: expected ${expected}, got ${actual}`);
  assert.ok(Math.abs(/** @type {number} */ (actual) - expected) <= fixture.rule.tolerance, `${name}: expected ${expected}, got ${actual}`);
}

test("the fixture states the same constants as the seed", () => {
  assert.equal(fixture.rule.windowDays, WINDOW_DAYS);
  assert.equal(fixture.rule.minValidDays, MIN_VALID_DAYS);
  assert.match(fixture.rule.spreadFloor, new RegExp(`${SPREAD_FLOOR_FRACTION}.*${SPREAD_FLOOR_ABSOLUTE}`));
});

test("the fixture covers the edge cases the spec names", () => {
  const names = fixture.comparisons.map((/** @type {{ name: string }} */ c) => c.name).join("\n");
  assert.match(names, /fewer than 5/);
  assert.match(names, /null today/);
  assert.match(names, /null days are skipped/);
  assert.match(names, /constant/);
  assert.match(names, /negative direction/);
  assert.match(names, /positive direction/);
});

for (const c of fixture.comparisons) {
  test(`comparison: ${c.name}`, () => {
    assertClose(compareWithBaseline(c.history, c.today), c.expected, c.name);
  });
}

for (const c of fixture.oriented) {
  test(`oriented: ${c.name}`, () => {
    assertClose(oriented(c.signal, c.comparison), c.expected, c.name);
  });
}

for (const c of fixture.composites) {
  test(`composite: ${c.name}`, () => {
    assertClose(composite(c.vsBaseline), c.expected, c.name);
  });
}
