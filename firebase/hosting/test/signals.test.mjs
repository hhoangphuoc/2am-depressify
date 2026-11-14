import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  SIGNAL_INFO,
  STALE_AFTER_DAYS,
  comparisonWord,
  defaultSelection,
  firstDataDate,
  formatValue,
  lastValueDate,
  signalSeries,
  signalState,
  signalSummary,
  signalWindow,
  sourceLabel,
} from "../js/lib/signals.js";
import { SIGNALS } from "../js/lib/contract.js";
import { compareWithBaseline } from "../js/lib/baseline.js";
import { addDays } from "../js/lib/dates.js";
import { phases } from "../js/lib/timeline.js";
import { generateDemoPatients } from "../../seed/src/generate.js";

const TODAY = "2026-11-14";

/** A daily doc with only `sleepMinutes` set (other keys null), and no stored comparison. */
function day(date, sleepMinutes, extra = {}) {
  const values = Object.fromEntries(SIGNALS.map((s) => [s.key, null]));
  values.sleepMinutes = sleepMinutes;
  return { date, values, ...extra };
}

/** `n` days ending on `end`, sleep from `valueOf(i)` (i = 0 for the oldest). */
function run(end, n, valueOf) {
  return Array.from({ length: n }, (_, i) => day(addDays(end, i - n + 1), valueOf(i)));
}

describe("SIGNAL_INFO", () => {
  test("covers all nine Signals, each with a label and a unit", () => {
    assert.deepEqual(Object.keys(SIGNAL_INFO), SIGNALS.map((s) => s.key));
    for (const info of Object.values(SIGNAL_INFO)) {
      assert.ok(info.label);
      assert.ok(info.unit);
    }
  });

  test("only time at home and movement radius come from location, and neither is a place", () => {
    const fromLocation = Object.entries(SIGNAL_INFO).filter(([, info]) => info.fromLocation).map(([key]) => key);
    assert.deepEqual(fromLocation, ["timeAtHomeMinutes", "movementRadiusKm"]);
  });
});

describe("formatValue", () => {
  test("states the unit, and a missing value is never zero", () => {
    assert.equal(formatValue("sleepMinutes", 430), "7 h 10 min");
    assert.equal(formatValue("sleepMinutes", 45), "45 min");
    assert.equal(formatValue("steps", 7600), "7,600 steps");
    assert.equal(formatValue("restingHeartRate", 58), "58 bpm");
    assert.equal(formatValue("hrv", 46), "46 ms");
    assert.equal(formatValue("movementRadiusKm", 6.25), "6.3 km");
    assert.equal(formatValue("timeAtHomeMinutes", 900), "15 h 0 min");
    assert.equal(formatValue("sleepMinutes", null), "No value");
    assert.equal(formatValue("steps", 0), "0 steps");
  });
});

describe("signalWindow and defaultSelection", () => {
  const list = phases("2026-10-03", [{ date: "2026-10-24" }], TODAY);

  test("the default is the current, latest Phase", () => {
    assert.equal(defaultSelection(list), 2);
    assert.equal(defaultSelection([]), "all");
  });

  test("a Phase gives its own days", () => {
    assert.deepEqual(signalWindow(1, list, { firstDate: "2026-10-04", today: TODAY }), { start: "2026-10-04", end: "2026-10-24" });
    assert.deepEqual(signalWindow(2, list, { firstDate: "2026-10-04", today: TODAY }), { start: "2026-10-25", end: TODAY });
  });

  test("all runs from the first record to today", () => {
    assert.deepEqual(signalWindow("all", list, { firstDate: "2026-10-04", today: TODAY }), { start: "2026-10-04", end: TODAY });
    assert.deepEqual(signalWindow("all", list, { firstDate: null, today: TODAY }), { start: TODAY, end: TODAY });
  });

  test("a Phase with no start (no TMS end date) starts at the first record", () => {
    const open = phases(null, [], TODAY);
    assert.deepEqual(signalWindow(1, open, { firstDate: "2026-11-01", today: TODAY }), { start: "2026-11-01", end: TODAY });
  });

  test("an unknown Phase falls back to all", () => {
    assert.deepEqual(signalWindow(9, list, { firstDate: "2026-10-04", today: TODAY }), { start: "2026-10-04", end: TODAY });
  });

  test("firstDataDate is the oldest valid record, never in the future", () => {
    assert.equal(firstDataDate([day("2026-11-10", 1), day("2026-11-02", 1), day("2026-12-01", 1), { date: "bad" }], TODAY), "2026-11-02");
    assert.equal(firstDataDate([], TODAY), null);
  });
});

describe("signalSeries", () => {
  test("is sorted by date, one point per calendar day of the window", () => {
    const docs = [day("2026-11-14", 400), day("2026-11-12", 410), day("2026-11-13", 420)];
    const series = signalSeries(docs, "sleepMinutes", { start: "2026-11-12", end: TODAY });
    assert.deepEqual(series.map((p) => p.date), ["2026-11-12", "2026-11-13", "2026-11-14"]);
    assert.deepEqual(series.map((p) => p.value), [410, 420, 400]);
  });

  test("keeps missing days as gaps (null), never zero", () => {
    const docs = [day("2026-11-10", 400), day("2026-11-12", null)]; // 11 and 13 have no record at all
    const series = signalSeries(docs, "sleepMinutes", { start: "2026-11-10", end: "2026-11-13" });
    assert.deepEqual(series.map((p) => p.value), [400, null, null, null]);
    assert.ok(series.every((p) => p.value !== 0));
    assert.ok(series.filter((p) => p.value === null).every((p) => p.comparison === null));
  });

  test("covers only the selected Phase, but takes the Baseline from the days before it", () => {
    const docs = run(TODAY, 20, (i) => 400 + i);
    const series = signalSeries(docs, "sleepMinutes", { start: "2026-11-12", end: TODAY });
    assert.equal(series.length, 3);
    // 14 valid days before 12 Nov, all outside the window.
    assert.equal(series[0].baseline.validDays, 14);
    assert.equal(series[0].baselineDays, 14);
  });

  test("uses the comparison stored on the daily record", () => {
    const docs = run(TODAY, 10, () => 400);
    docs[9] = { ...docs[9], values: { ...docs[9].values, sleepMinutes: 380 }, vsBaseline: { sleepMinutes: 1.23 } };
    const series = signalSeries(docs, "sleepMinutes", { start: TODAY, end: TODAY });
    assert.equal(series[0].comparison, 1.23);
  });

  test("keeps a stored null comparison, and computes one only when none was stored", () => {
    const docs = run(TODAY, 10, (i) => 400 + 10 * i);
    const stored = docs.map((d) => ({ ...d, vsBaseline: { sleepMinutes: null } }));
    assert.equal(signalSeries(stored, "sleepMinutes", { start: TODAY, end: TODAY })[0].comparison, null);
    const computed = signalSeries(docs, "sleepMinutes", { start: TODAY, end: TODAY })[0].comparison;
    const history = docs.map((d) => ({ date: d.date, value: d.values.sleepMinutes }));
    assert.equal(computed, compareWithBaseline(history, { date: TODAY, value: 490 }));
  });

  test("a non-number value is a gap", () => {
    const docs = [day(TODAY, "400"), { date: "2026-11-13", values: {} }];
    assert.deepEqual(signalSeries(docs, "sleepMinutes", { start: "2026-11-13", end: TODAY }).map((p) => p.value), [null, null]);
  });
});

describe("signalSummary: the insufficient-Baseline decision", () => {
  test("fewer than 5 valid days in the range shows insufficient Baseline", () => {
    const docs = run(TODAY, 30, (i) => (i >= 26 ? 400 : 420));
    const series = signalSeries(docs, "sleepMinutes", { start: "2026-11-11", end: TODAY });
    const summary = signalSummary(series, "sleepMinutes");
    assert.equal(summary.validDays, 4);
    assert.equal(summary.status, "insufficient_baseline");
    assert.equal(summary.reason, "range");
    assert.equal(summary.comparison, null);
  });

  test("fewer than 5 valid days before the latest value shows insufficient Baseline", () => {
    const docs = run(TODAY, 6, () => 420);
    const series = signalSeries(docs, "sleepMinutes", { start: addDays(TODAY, -5), end: TODAY });
    const summary = signalSummary(series, "sleepMinutes");
    assert.equal(summary.validDays, 6);
    assert.equal(summary.status, "compared"); // the latest has 5 days before it
    const short = signalSummary(signalSeries(docs.slice(1), "sleepMinutes", { start: addDays(TODAY, -4), end: TODAY }), "sleepMinutes");
    assert.equal(short.status, "insufficient_baseline");
  });

  test("the comparison uses the latest day with a value", () => {
    const docs = [...run("2026-11-13", 20, () => 420), day(TODAY, null)];
    const summary = signalSummary(signalSeries(docs, "sleepMinutes", { start: "2026-11-01", end: TODAY }), "sleepMinutes");
    assert.equal(summary.latest.date, "2026-11-13");
    assert.equal(summary.days, 14);
    assert.equal(summary.validDays, 13);
    assert.equal(summary.status, "compared");
  });

  test("with no value in the range there is nothing to compare", () => {
    const docs = run(TODAY, 3, () => null);
    const summary = signalSummary(signalSeries(docs, "sleepMinutes", { start: "2026-11-12", end: TODAY }), "sleepMinutes");
    assert.equal(summary.status, "no_values");
    assert.equal(summary.validDays, 0);
    assert.equal(summary.latest, null);
  });

  test("a compared Signal carries its oriented value and words", () => {
    const docs = run(TODAY, 20, () => 420);
    docs[19] = { ...docs[19], vsBaseline: { sleepMinutes: -1.9 } };
    const summary = signalSummary(signalSeries(docs, "sleepMinutes", { start: "2026-11-01", end: TODAY }), "sleepMinutes");
    assert.equal(summary.status, "compared");
    assert.equal(summary.comparison, -1.9);
    assert.equal(summary.oriented, -1.9);
    assert.equal(summary.word, "worse than usual");
  });
});

describe("comparisonWord", () => {
  test("higher is better", () => {
    assert.equal(comparisonWord("steps", 1.5), "better than usual");
    assert.equal(comparisonWord("steps", -1), "worse than usual");
    assert.equal(comparisonWord("steps", 0.4), "within the usual range");
  });

  test("lower is better flips the sign", () => {
    assert.equal(comparisonWord("restingHeartRate", 2), "worse than usual");
    assert.equal(comparisonWord("timeAtHomeMinutes", -1.2), "better than usual");
  });

  test("Signals with no direction are never better or worse", () => {
    assert.equal(comparisonWord("meanHeartRate", 3), "higher than usual");
    assert.equal(comparisonWord("calendarBusyMinutes", -3), "lower than usual");
    assert.equal(comparisonWord("calendarBusyMinutes", 0.2), "within the usual range");
  });

  test("no comparison gives no words", () => {
    assert.equal(comparisonWord("steps", null), null);
  });
});

describe("signalState", () => {
  const docs = run(TODAY, 5, () => 420);

  test("no Consent wins over everything, even when values exist", () => {
    assert.equal(signalState({ consent: { granted: false }, docs, key: "sleepMinutes", today: TODAY }), "no_consent");
    assert.equal(signalState({ consent: undefined, docs, key: "sleepMinutes", today: TODAY }), "no_consent");
  });

  test("granted with no value ever is no source data", () => {
    assert.equal(signalState({ consent: { granted: true }, docs, key: "steps", today: TODAY }), "no_data");
    assert.equal(signalState({ consent: { granted: true }, docs: [], key: "steps", today: TODAY }), "no_data");
  });

  test(`a latest value more than ${STALE_AFTER_DAYS} days old is stale`, () => {
    const old = run(addDays(TODAY, -STALE_AFTER_DAYS - 1), 5, () => 420);
    assert.equal(signalState({ consent: { granted: true }, docs: old, key: "sleepMinutes", today: TODAY }), "stale");
    const recent = run(addDays(TODAY, -STALE_AFTER_DAYS), 5, () => 420);
    assert.equal(signalState({ consent: { granted: true }, docs: recent, key: "sleepMinutes", today: TODAY }), "ok");
  });

  test("lastValueDate ignores nulls and future dates", () => {
    assert.equal(lastValueDate([day("2026-11-10", 400), day("2026-11-12", null), day("2026-11-20", 400)], "sleepMinutes", TODAY), "2026-11-10");
    assert.equal(lastValueDate([], "sleepMinutes", TODAY), null);
  });
});

describe("sourceLabel", () => {
  test("says device or synthetic", () => {
    assert.match(sourceLabel("synthetic"), /synthetic/i);
    assert.match(sourceLabel("device"), /device/i);
    assert.match(sourceLabel(undefined), /unknown/i);
  });
});

describe("with the Demo Patients", () => {
  const patients = generateDemoPatients({ today: TODAY });

  test("the stored comparisons agree with the dashboard's Baseline helper", () => {
    for (const p of patients) {
      const docs = p.daily.map((d) => d.data);
      for (const { key } of SIGNALS) {
        const stored = signalSeries(docs, key, { start: docs[0].date, end: TODAY });
        const recomputed = signalSeries(
          docs.map(({ vsBaseline, ...rest }) => rest),
          key,
          { start: docs[0].date, end: TODAY },
        );
        stored.forEach((point, i) => {
          const other = recomputed[i].comparison;
          if (point.comparison === null) assert.equal(other, null, `${p.id} ${key} ${point.date}`);
          else assert.ok(Math.abs(point.comparison - other) < 1e-9, `${p.id} ${key} ${point.date}`);
        });
      }
    }
  });

  test("the sparse Patient's current Phase has gaps and no zero in place of a missing value", () => {
    const sparse = patients.find((p) => p.id === "demo-sparse");
    const docs = sparse.daily.map((d) => d.data);
    const list = phases(sparse.patient.tmsEndDate, sparse.visits.map((v) => v.data), TODAY);
    const window = signalWindow(defaultSelection(list), list, { firstDate: firstDataDate(docs, TODAY), today: TODAY });
    const series = signalSeries(docs, "steps", window);
    const stored = new Map(docs.map((d) => [d.date, d.values.steps]));
    assert.ok(series.some((p) => p.value === null));
    for (const point of series) assert.equal(point.value, stored.get(point.date) ?? null);
  });
});
