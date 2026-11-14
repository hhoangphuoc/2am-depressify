import { test } from "node:test";
import assert from "node:assert/strict";
import { freshness, latestCheckInText, levelWord, patientListRows, toListRow } from "../js/lib/list-row.js";

const TZ = "Europe/Helsinki";
// 14 November 2026, 12:00 in Helsinki (UTC+2).
const NOW = Date.UTC(2026, 10, 14, 10, 0);
const HOUR = 3_600_000;
const at = (y, m, d, h, min) => Date.UTC(y, m - 1, d, h - 2, min); // Helsinki wall clock in winter

test("the level is a word, never a colour alone or a number", () => {
  assert.equal(levelWord("red"), "Red");
  assert.equal(levelWord("amber"), "Amber");
  assert.equal(levelWord("green"), "Green");
  assert.equal(levelWord(undefined), "Green");
});

test("latest Check-in reads as a day, with the time when it was recent", () => {
  assert.equal(latestCheckInText(null, NOW, TZ), "No Check-in yet");
  assert.equal(latestCheckInText(at(2026, 11, 14, 8, 5), NOW, TZ), "Today, 08:05");
  assert.equal(latestCheckInText(at(2026, 11, 13, 19, 42), NOW, TZ), "Yesterday, 19:42");
  // 23:30 in Helsinki two days ago is still "2 days ago", although it is under 48 hours.
  assert.equal(latestCheckInText(at(2026, 11, 12, 23, 30), NOW, TZ), "2 days ago");
  assert.equal(latestCheckInText(at(2026, 11, 8, 19, 0), NOW, TZ), "6 days ago");
  assert.equal(latestCheckInText(at(2026, 11, 3, 19, 0), NOW, TZ), "3 Nov");
  assert.equal(latestCheckInText(at(2025, 12, 30, 19, 0), NOW, TZ), "30 Dec 2025");
});

test("a Check-in time slightly in the future (clock skew) reads as today", () => {
  assert.equal(latestCheckInText(NOW + 60_000, NOW, TZ), "Today, 12:01");
});

test("freshness says how old the data is, and marks it stale after a day", () => {
  assert.deepEqual(freshness(null, NOW), { text: "No data yet", stale: true });
  assert.deepEqual(freshness(NOW - 10 * 60_000, NOW), { text: "Updated in the last hour", stale: false });
  assert.deepEqual(freshness(NOW - 1.5 * HOUR, NOW), { text: "Updated 1 hour ago", stale: false });
  assert.deepEqual(freshness(NOW - 5 * HOUR, NOW), { text: "Updated 5 hours ago", stale: false });
  assert.deepEqual(freshness(NOW - 25 * HOUR, NOW), { text: "No data for 1 day", stale: true });
  assert.deepEqual(freshness(NOW - 50 * HOUR, NOW), { text: "No data for 2 days", stale: true });
  assert.deepEqual(freshness(NOW + HOUR, NOW), { text: "Updated in the last hour", stale: false });
});

test("a row carries the name, level word, reasons, latest Check-in and freshness", () => {
  const row = toListRow(
    {
      id: "demo-declining",
      data: {
        displayName: "Mikko (demo)",
        flagLevel: "red",
        flagReasons: ["Slept under 3 hours last night.", "Rated mood low at each of the last three Check-ins."],
        lastCheckInAtMillis: at(2026, 11, 12, 19, 30),
        lastSeenAtMillis: at(2026, 11, 14, 7, 16),
      },
    },
    { nowMillis: NOW, timeZone: TZ },
  );
  assert.deepEqual(row, {
    id: "demo-declining",
    displayName: "Mikko (demo)",
    flagLevel: "red",
    levelWord: "Red",
    reasons: ["Slept under 3 hours last night.", "Rated mood low at each of the last three Check-ins."],
    latestCheckIn: "2 days ago",
    freshness: "Updated 4 hours ago",
    stale: false,
  });
});

test("missing fields give honest defaults, never invented values", () => {
  const row = toListRow({ id: "p9", data: {} }, { nowMillis: NOW, timeZone: TZ });
  assert.equal(row.displayName, "Unnamed patient");
  assert.equal(row.flagLevel, "green");
  assert.deepEqual(row.reasons, ["Nothing raised."]);
  assert.equal(row.latestCheckIn, "No Check-in yet");
  assert.equal(row.freshness, "No data yet");
  assert.equal(row.stale, true);
});

test("an amber or red level without reasons says so instead of looking fine", () => {
  const row = toListRow({ id: "p", data: { flagLevel: "amber", flagReasons: [] } }, { nowMillis: NOW, timeZone: TZ });
  assert.deepEqual(row.reasons, ["No reason recorded."]);
});

test("rows are sorted red, amber, green, then newest flag, then name", () => {
  const docs = [
    { id: "s", data: { displayName: "Aino (demo)", flagLevel: "green" } },
    { id: "a2", data: { displayName: "Bea", flagLevel: "amber" } },
    { id: "r", data: { displayName: "Mikko (demo)", flagLevel: "red" } },
    { id: "a1", data: { displayName: "Sara (demo)", flagLevel: "amber" } },
  ];
  const rows = patientListRows(docs, { a1: 2_000, a2: 1_000 }, { nowMillis: NOW, timeZone: TZ });
  assert.deepEqual(rows.map((r) => r.id), ["r", "a1", "a2", "s"]);
});

test("no number that reads as a score appears on a row", () => {
  const rows = patientListRows(
    [
      {
        id: "x",
        data: {
          displayName: "Demo",
          flagLevel: "amber",
          flagReasons: ["Rated mood low at each of the last three Check-ins."],
          lastCheckInAtMillis: NOW - 30 * HOUR,
          lastSeenAtMillis: NOW - 2 * HOUR,
          // Fields that must never reach the list, even if present on a document.
          composite: -1.37,
          outcomeScore: 0.42,
        },
      },
    ],
    {},
    { nowMillis: NOW, timeZone: TZ },
  );
  const text = JSON.stringify(rows);
  assert.doesNotMatch(text, /\d[.,]\d|%|score|composite|-1\.37|0\.42/i);
});
