import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, dateInZone, daysBetween, isDateKey, mondayOf } from "../js/lib/dates.js";

test("isDateKey accepts real yyyy-MM-dd dates only", () => {
  for (const ok of ["2026-11-14", "2024-02-29"]) assert.equal(isDateKey(ok), true, ok);
  for (const bad of ["", "2026-11-31", "2025-02-29", "14.11.2026", "2026-1-4", null, undefined, 20261114]) {
    assert.equal(isDateKey(bad), false, String(bad));
  }
});

test("addDays and daysBetween work across months, years and summer time", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addDays("2026-03-28", 2), "2026-03-30");
  assert.equal(daysBetween("2026-10-03", "2026-11-14"), 42);
  assert.equal(daysBetween("2026-11-14", "2026-10-03"), -42);
});

test("mondayOf gives the Monday of the date's week", () => {
  assert.equal(mondayOf("2026-11-14"), "2026-11-09"); // a Saturday
  assert.equal(mondayOf("2026-11-09"), "2026-11-09"); // a Monday
  assert.equal(mondayOf("2026-11-15"), "2026-11-09"); // a Sunday
});

test("dateInZone gives the calendar date in a time zone", () => {
  const lateEveningUtc = Date.UTC(2026, 10, 13, 22, 30); // 00:30 on the 14th in Helsinki
  assert.equal(dateInZone(lateEveningUtc, "Europe/Helsinki"), "2026-11-14");
  assert.equal(dateInZone(lateEveningUtc, "UTC"), "2026-11-13");
});
