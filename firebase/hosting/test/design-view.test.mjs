import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FILTER_LABELS,
  connectionText,
  laneTicks,
  patientMeta,
  phaseStrip,
  placeOf,
  rosterCountText,
  sparkline,
  workspaceMeta,
} from "../js/lib/design-view.js";
import { phases } from "../js/lib/timeline.js";

// 13 Nov 2026, 14:20 in Helsinki (UTC+2).
const NOW = Date.UTC(2026, 10, 13, 12, 20);

test("the workspace line names the day and the place", () => {
  assert.deepEqual(workspaceMeta(NOW, "Europe/Helsinki"), { date: "Friday, 13 November 2026", time: "Helsinki · 14:20" });
  assert.equal(placeOf("America/New_York"), "New York");
  assert.equal(placeOf("UTC"), "UTC");
  assert.equal(placeOf(""), "Local time");
});

test("connection freshness: live, saved copy, loading and failure", () => {
  assert.deepEqual(connectionText({ status: "ok", fromCache: false, updatedAtMillis: NOW }, "Europe/Helsinki"), { text: "Live · updated 14:20", offline: false });
  assert.deepEqual(connectionText({ status: "ok", fromCache: true, updatedAtMillis: NOW }, "Europe/Helsinki"), { text: "Saved view · 14:20", offline: true });
  assert.equal(connectionText({ status: "loading", fromCache: false }, "UTC").text, "Connecting…");
  assert.equal(connectionText({ status: "denied", fromCache: false }, "UTC").offline, true);
});

test("filter labels use the design's words and the count line says how the list is ordered", () => {
  assert.equal(FILTER_LABELS.unknown, "Unassessed");
  assert.equal(rosterCountText(2, 3), "2 of 3 Patients · ordered by Attention flag");
  assert.equal(rosterCountText(1, 1), "1 of 1 Patient · ordered by Attention flag");
});

test("the Patient header gives the week since TMS, or says the date is missing", () => {
  assert.deepEqual(patientMeta({ tmsEndDate: "2026-10-02", synthetic: true }, "2026-11-13"), ["Week 6 since TMS", "Demo Patient"]);
  assert.deepEqual(patientMeta({ tmsEndDate: null }, "2026-11-13"), ["TMS end date not recorded"]);
  assert.deepEqual(patientMeta({ tmsEndDate: "2026-11-13" }, "2026-11-13"), ["TMS ended 13 Nov"]);
});

/** @param {(number | null)[]} values */
const rows = (values) => values.map((sleep, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, sleep }));

test("sparkline: gaps are hatched, never drawn as zero, and the Baseline is the Patient's own", () => {
  const model = sparkline(rows([6.5, 6.4, null, 6.6, 6.5, 6.7, 6.3, 6.6, 6.5, 6.4, 6.5, null, 6.6, 2.4]));
  assert.ok(model);
  assert.equal(model.gaps.length, 2);
  assert.equal(model.segments.length, 3);
  assert.equal(model.segments.flat().length, 12);
  assert.notEqual(model.baselineY, null);
  assert.ok(model.last && model.last.y > /** @type {number} */ (model.baselineY), "2.4 h sits below a 6.5 h Baseline");
  assert.match(model.label, /^Sleep, last 14 days\. Latest 2\.4 h, Baseline 6\.5 h, 2 days without data\.$/);
});

test("sparkline: fewer than 5 valid days has no Baseline; no values at all draws nothing", () => {
  const few = sparkline(rows([null, null, 6, 7]));
  assert.ok(few);
  assert.equal(few.baselineY, null);
  assert.ok(few.last && few.last.x > 100, "right-aligned to the last day");
  assert.equal(sparkline(rows([null, null])), null);
  assert.equal(sparkline([]), null);
});

test("Phase strip: one segment per Phase, sized by days on the axis", () => {
  const list = phases("2026-10-02", [{ date: "2026-10-23" }], "2026-11-13");
  const strip = phaseStrip(list, { origin: "2026-10-02", span: 42, today: "2026-11-13" });
  assert.deepEqual(
    strip.map((s) => [s.label, s.days, s.dates]),
    [
      ["Phase 1", 21, "3 Oct – 23 Oct"],
      ["Phase 2", 21, "24 Oct – 13 Nov"],
    ],
  );
  assert.equal(strip.reduce((n, s) => n + s.days, 0), 42);
});

test("Phase strip: a Phase that starts later gets a spacer so it lines up with the lanes", () => {
  const list = [{ number: 1, start: "2026-10-10", end: "2026-10-20", from: { kind: "visit", date: "2026-10-09" }, to: { kind: "today", date: "2026-10-20" } }];
  const strip = phaseStrip(/** @type {any} */ (list), { origin: "2026-10-02", span: 21, today: "2026-10-20" });
  assert.deepEqual(strip.map((s) => [s.spacer, s.days]), [[true, 7], [false, 11]]);
});

test("lane ticks: weekly back from today, at each date's centre, thinned at narrow widths", () => {
  const wide = laneTicks({ origin: "2026-10-02", span: 42, today: "2026-11-13", plotWidth: 640 });
  assert.deepEqual(wide.map((t) => t.label), ["9 Oct", "16 Oct", "23 Oct", "30 Oct", "6 Nov", "13 Nov"]);
  assert.equal(wide.at(-1).at, 41.5);
  const narrow = laneTicks({ origin: "2026-10-02", span: 42, today: "2026-11-13", plotWidth: 300 });
  assert.deepEqual(narrow.map((t) => t.at), [13.5, 27.5, 41.5]);
});
