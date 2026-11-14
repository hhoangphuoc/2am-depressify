import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, dateInZone, daysBetween, zonedMillis } from "../../src/dates.js";

test("adding days crosses months, years and leap days", () => {
  assert.equal(addDays("2026-11-14", -42), "2026-10-03");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(daysBetween("2026-10-03", "2026-11-14"), 42);
});

test("local times are in Europe/Helsinki, across the daylight-saving change", () => {
  // Summer time (UTC+3) and winter time (UTC+2).
  assert.equal(zonedMillis("2026-07-01", 7, 10), Date.UTC(2026, 6, 1, 4, 10));
  assert.equal(zonedMillis("2026-11-14", 7, 10), Date.UTC(2026, 10, 14, 5, 10));
  // The night the clocks go back (25 October 2026).
  assert.equal(zonedMillis("2026-10-25", 12, 0), Date.UTC(2026, 9, 25, 10, 0));
});

test("the date of an instant is taken in Helsinki, not UTC", () => {
  assert.equal(dateInZone(Date.UTC(2026, 10, 13, 22, 30)), "2026-11-14");
  assert.equal(dateInZone(Date.UTC(2026, 10, 13, 21, 30)), "2026-11-13");
});
