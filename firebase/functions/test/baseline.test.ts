// The shared Baseline fixture (fixtures/baseline/baseline-cases.json) run through the functions'
// copy of the rule, which Finish Check-in uses for an Outcome's `objectiveChange` (#21). The
// dashboard and the seed run the same fixture through their copy.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIN_VALID_DAYS, WINDOW_DAYS, baselineFor, compareWithBaseline, oriented, type DatedValue } from "../src/baseline";

const fixture = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "fixtures", "baseline", "baseline-cases.json"), "utf8"));
const tolerance: number = fixture.rule.tolerance;

function expectClose(actual: number | null, expected: number | null) {
  if (expected === null) return expect(actual).toBeNull();
  expect(actual).not.toBeNull();
  expect(Math.abs(actual! - expected)).toBeLessThanOrEqual(tolerance);
}

describe("the Baseline rule (functions' copy)", () => {
  it("states the same window and minimum as the fixture", () => {
    expect(WINDOW_DAYS).toBe(fixture.rule.windowDays);
    expect(MIN_VALID_DAYS).toBe(fixture.rule.minValidDays);
  });

  it.each(fixture.comparisons as { name: string; today: DatedValue; history: DatedValue[]; expected: number | null }[])("comparison: $name", (c) => {
    expectClose(compareWithBaseline(c.history, c.today), c.expected);
    if (c.expected !== null) expect(baselineFor(c.history, c.today.date)!.validDays).toBeGreaterThanOrEqual(MIN_VALID_DAYS);
  });

  it.each(fixture.oriented as { name: string; signal: string; comparison: number | null; expected: number | null }[])("oriented: $name", (c) => {
    expectClose(oriented(c.signal, c.comparison), c.expected);
  });
});
