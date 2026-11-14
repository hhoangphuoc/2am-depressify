// The shared Outcome fixture (fixtures/outcomes/outcome-cases.json, #21) run through the seed's
// Outcome score, so seeded scores follow the rule Finish Check-in (firebase/functions/src/outcomes.ts)
// and core's Kotlin `Outcomes.score` follow.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { outcomeScore } from "../../src/generate.js";

const fixture = JSON.parse(readFileSync(new URL("../../../../fixtures/outcomes/outcome-cases.json", import.meta.url), "utf8"));

test("the fixture has score cases", () => assert.ok(fixture.scores.length > 0));

for (const c of fixture.scores) {
  test(`Outcome score: ${c.name}`, () => {
    const actual = outcomeScore(c.tried, c.felt, c.objectiveChange);
    if (c.expected === null) return assert.equal(actual, null);
    assert.equal(typeof actual, "number");
    assert.ok(Math.abs(/** @type {number} */ (actual) - c.expected) <= fixture.rule.tolerance, `${c.name}: expected ${c.expected}, got ${actual}`);
  });
}
