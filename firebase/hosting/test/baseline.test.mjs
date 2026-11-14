// The shared Baseline fixture (fixtures/baseline/baseline-cases.json) run through the dashboard's
// helper, which is the one the seed re-exports. Core's Kotlin Baseline tests read the same file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MIN_VALID_DAYS,
  WINDOW_DAYS,
  baselineFor,
  compareWithBaseline,
  composite,
  oriented,
} from "../js/lib/baseline.js";
import * as seedBaseline from "../../seed/src/baseline.js";

const fixture = JSON.parse(readFileSync(new URL("../../../fixtures/baseline/baseline-cases.json", import.meta.url), "utf8"));

function assertClose(actual, expected, name) {
  if (expected === null) {
    assert.equal(actual, null, `${name}: expected null, got ${actual}`);
    return;
  }
  assert.equal(typeof actual, "number", `${name}: expected ${expected}, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= fixture.rule.tolerance, `${name}: expected ${expected}, got ${actual}`);
}

test("the fixture states the same window and minimum as the dashboard", () => {
  assert.equal(fixture.rule.windowDays, WINDOW_DAYS);
  assert.equal(fixture.rule.minValidDays, MIN_VALID_DAYS);
});

test("the seed uses this very helper, not a copy", () => {
  assert.equal(seedBaseline.compareWithBaseline, compareWithBaseline);
  assert.equal(seedBaseline.baselineFor, baselineFor);
  assert.equal(seedBaseline.composite, composite);
  assert.equal(seedBaseline.oriented, oriented);
});

for (const c of fixture.comparisons) {
  test(`comparison: ${c.name}`, () => {
    assertClose(compareWithBaseline(c.history, c.today), c.expected, c.name);
  });
  test(`Baseline exists exactly when there are ${MIN_VALID_DAYS} valid days: ${c.name}`, () => {
    const baseline = baselineFor(c.history, c.today.date);
    if (c.today.value !== null && c.expected === null) assert.equal(baseline, null);
    if (c.expected !== null) {
      assert.ok(baseline);
      assert.ok(baseline.validDays >= MIN_VALID_DAYS);
      assertClose((c.today.value - baseline.centre) / baseline.spread, c.expected, c.name);
    }
  });
}

for (const c of fixture.oriented) {
  test(`oriented: ${c.name}`, () => assertClose(oriented(c.signal, c.comparison), c.expected, c.name));
}

for (const c of fixture.composites) {
  test(`composite: ${c.name}`, () => assertClose(composite(c.vsBaseline), c.expected, c.name));
}
