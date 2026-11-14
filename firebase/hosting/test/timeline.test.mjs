import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  inPhase,
  moodByWeek,
  phaseOf,
  phases,
  questionnairePoints,
  pointsByKind,
  timelineRows,
  weekOf,
  weekRange,
} from "../js/lib/timeline.js";
import { generateDemoPatients } from "../../seed/src/generate.js";
import { zonedMillis } from "../../seed/src/dates.js";

const TMS_END = "2026-10-03";
const TODAY = "2026-11-14"; // 42 days after TMS ended
const TZ = "Europe/Helsinki";

/** A Check-in at 19:00 Helsinki time on `date`. */
const checkIn = (date, mood) => ({ startedAtMillis: zonedMillis(date, 19, 0, TZ), mood });

describe("weekOf", () => {
  test("week 1 starts the day after TMS ended", () => {
    assert.equal(weekOf("2026-10-04", TMS_END), 1);
    assert.equal(weekOf("2026-10-10", TMS_END), 1);
    assert.equal(weekOf("2026-10-11", TMS_END), 2);
    assert.equal(weekOf("2026-10-24", TMS_END), 3);
    assert.equal(weekOf("2026-10-25", TMS_END), 4);
    assert.equal(weekOf(TODAY, TMS_END), 6);
  });

  test("the TMS end day and earlier are before week 1", () => {
    assert.equal(weekOf(TMS_END, TMS_END), 0);
    assert.ok(weekOf("2026-09-20", TMS_END) < 1);
  });

  test("without a TMS end date there is no week number", () => {
    assert.equal(weekOf("2026-10-24", null), null);
    assert.equal(weekOf("2026-10-24", ""), null);
    assert.equal(weekOf("not a date", TMS_END), null);
  });

  test("weekRange gives the first and last day of a week", () => {
    assert.deepEqual(weekRange(1, TMS_END), { start: "2026-10-04", end: "2026-10-10" });
    assert.deepEqual(weekRange(3, TMS_END), { start: "2026-10-18", end: "2026-10-24" });
  });
});

describe("phases", () => {
  test("phasesSplitAtVisits: end of TMS to the first Visit, Visit to Visit, last Visit to today", () => {
    const result = phases(TMS_END, [{ date: "2026-11-01" }, { date: "2026-10-24" }], TODAY);
    assert.deepEqual(
      result.map((p) => [p.number, p.start, p.end, p.from.kind, p.to.kind]),
      [
        [1, "2026-10-04", "2026-10-24", "tms_end", "visit"],
        [2, "2026-10-25", "2026-11-01", "visit", "visit"],
        [3, "2026-11-02", TODAY, "visit", "today"],
      ],
    );
    assert.deepEqual(
      result.map((p) => [p.startWeek, p.endWeek]),
      [
        [1, 3],
        [4, 5],
        [5, 6],
      ],
    );
  });

  test("noVisitsGivesOnePhase from the end of TMS to today", () => {
    const [only, ...rest] = phases(TMS_END, [], TODAY);
    assert.equal(rest.length, 0);
    assert.equal(only.start, "2026-10-04");
    assert.equal(only.end, TODAY);
    assert.equal(only.from.kind, "tms_end");
    assert.equal(only.to.kind, "today");
  });

  test("a backdated Visit recomputes the boundaries", () => {
    const before = phases(TMS_END, [{ date: "2026-11-01" }], TODAY);
    const after = phases(TMS_END, [{ date: "2026-11-01" }, { date: "2026-10-15" }], TODAY);
    assert.deepEqual(before.map((p) => p.end), ["2026-11-01", TODAY]);
    assert.deepEqual(after.map((p) => p.end), ["2026-10-15", "2026-11-01", TODAY]);
    assert.equal(after[1].start, "2026-10-16");
  });

  test("two Visits on one day make one boundary; future, invalid and pre-TMS dates are ignored", () => {
    const result = phases(
      TMS_END,
      [{ date: "2026-10-24" }, { date: "2026-10-24" }, { date: "2026-12-01" }, { date: "bad" }, { date: "2026-09-01" }],
      TODAY,
    );
    assert.deepEqual(result.map((p) => p.end), ["2026-10-24", TODAY]);
  });

  test("a Visit today closes the last Phase; no empty Phase follows", () => {
    const result = phases(TMS_END, [{ date: TODAY }], TODAY);
    assert.deepEqual(result.map((p) => [p.start, p.end, p.to.kind]), [["2026-10-04", TODAY, "visit"]]);
  });

  test("without a TMS end date the first Phase has an open start and no weeks", () => {
    const result = phases(null, [{ date: "2026-10-24" }], TODAY);
    assert.equal(result.length, 2);
    assert.equal(result[0].start, null);
    assert.equal(result[0].from.kind, "tms_end");
    assert.equal(result[0].startWeek, null);
    assert.equal(result[1].start, "2026-10-25");
  });

  test("phaseOf and inPhase select a Phase by date", () => {
    const result = phases(TMS_END, [{ date: "2026-10-24" }], TODAY);
    assert.equal(phaseOf("2026-10-24", result)?.number, 1);
    assert.equal(phaseOf("2026-10-25", result)?.number, 2);
    assert.equal(phaseOf(TMS_END, result), null);
    assert.equal(inPhase("2026-10-10", result[0]), true);
    assert.equal(inPhase("2026-10-10", result[1]), false);
    const open = phases(null, [], TODAY)[0];
    assert.equal(inPhase("2020-01-01", open), true);
  });
});

describe("moodByWeek", () => {
  test("averages each week's Mood ratings on the 1 to 5 scale", () => {
    const result = moodByWeek([checkIn("2026-10-04", 4), checkIn("2026-10-08", 3), checkIn("2026-10-11", 2)], TMS_END, {
      today: TODAY,
      timeZone: TZ,
    });
    assert.equal(result.length, 6);
    assert.deepEqual(result[0], { week: 1, start: "2026-10-04", end: "2026-10-10", mean: 3.5, n: 2 });
    assert.deepEqual(result[1], { week: 2, start: "2026-10-11", end: "2026-10-17", mean: 2, n: 1 });
  });

  test("moodByWeekSkipsNullMoods and weeks with no rating are gaps", () => {
    const result = moodByWeek([checkIn("2026-10-04", null), checkIn("2026-10-20", 5)], TMS_END, { today: TODAY, timeZone: TZ });
    assert.deepEqual(
      result.map((w) => [w.week, w.mean, w.n]),
      [
        [1, null, 0],
        [2, null, 0],
        [3, 5, 1],
        [4, null, 0],
        [5, null, 0],
        [6, null, 0],
      ],
    );
  });

  test("ignores ratings outside 1 to 5, before week 1 and after today", () => {
    const result = moodByWeek(
      [checkIn("2026-10-05", 0), checkIn("2026-10-05", 6), checkIn("2026-10-05", 2.5), checkIn(TMS_END, 1), checkIn("2026-11-20", 1)],
      TMS_END,
      { today: TODAY, timeZone: TZ },
    );
    assert.ok(result.every((w) => w.mean === null && w.n === 0));
  });

  test("a Check-in belongs to its date in the time zone", () => {
    // 23:30 UTC on 10 Oct is 02:30 on 11 Oct in Helsinki: week 2.
    const result = moodByWeek([{ startedAtMillis: Date.UTC(2026, 9, 10, 23, 30), mood: 4 }], TMS_END, { today: TODAY, timeZone: TZ });
    assert.equal(result[0].n, 0);
    assert.equal(result[1].n, 1);
  });

  test("without a TMS end date it uses calendar weeks from Monday, with no week numbers", () => {
    const result = moodByWeek([checkIn("2026-10-28", 3), checkIn("2026-11-12", 4)], null, { today: TODAY, timeZone: TZ });
    assert.deepEqual(
      result.map((w) => [w.week, w.start, w.end, w.mean]),
      [
        [null, "2026-10-26", "2026-11-01", 3],
        [null, "2026-11-02", "2026-11-08", null],
        [null, "2026-11-09", "2026-11-15", 4],
      ],
    );
  });

  test("no TMS end date and no ratings gives no weeks", () => {
    assert.deepEqual(moodByWeek([], null, { today: TODAY, timeZone: TZ }), []);
  });
});

describe("questionnairePoints", () => {
  const visits = [
    { id: "b", date: "2026-11-01", questionnaire: "phq2", score: 3 },
    { id: "a", date: "2026-10-24", questionnaire: "phq9", score: 9 },
    { id: "c", date: "2026-10-30", questionnaire: null, score: null },
    { id: "d", date: "2026-10-31", questionnaire: "phq2", score: 12 },
    { id: "e", date: "2026-10-31", questionnaire: "gad7", score: 5 },
  ];

  test("questionnairePointsCarryTheirKind, sorted by date, with the week", () => {
    assert.deepEqual(questionnairePoints(visits, TMS_END), [
      { id: "a", date: "2026-10-24", week: 3, questionnaire: "phq9", score: 9 },
      { id: "b", date: "2026-11-01", week: 5, questionnaire: "phq2", score: 3 },
    ]);
  });

  test("a Visit with no score, a score out of range or an unknown kind gives no point", () => {
    const ids = questionnairePoints(visits, TMS_END).map((p) => p.id);
    assert.ok(!ids.includes("c") && !ids.includes("d") && !ids.includes("e"));
  });

  test("without a TMS end date the points keep their dates and have no week", () => {
    assert.deepEqual(questionnairePoints(visits, null).map((p) => p.week), [null, null]);
  });

  test("PHQ-2 and PHQ-9 are never joined: one series per kind", () => {
    const series = pointsByKind(
      questionnairePoints(
        [
          { id: "1", date: "2026-10-10", questionnaire: "phq9", score: 12 },
          { id: "2", date: "2026-10-20", questionnaire: "phq2", score: 2 },
          { id: "3", date: "2026-10-30", questionnaire: "phq9", score: 8 },
        ],
        TMS_END,
      ),
    );
    assert.deepEqual(Object.keys(series), ["phq9", "phq2"]);
    assert.deepEqual(series.phq9.map((p) => p.id), ["1", "3"]);
    assert.deepEqual(series.phq2.map((p) => p.id), ["2"]);
  });
});

describe("timelineRows", () => {
  test("one row per week with its Phases, mood and the Visits in it", () => {
    const visits = [{ id: "v", date: "2026-10-24", questionnaire: "phq9", score: 9 }];
    const weeks = moodByWeek([checkIn("2026-10-20", 3)], TMS_END, { today: TODAY, timeZone: TZ });
    const rows = timelineRows(weeks, visits, phases(TMS_END, visits, TODAY));
    assert.equal(rows.length, 6);
    assert.deepEqual(rows[2], { week: 3, start: "2026-10-18", end: "2026-10-24", phases: [1], mean: 3, n: 1, visits: [visits[0]] });
    assert.deepEqual(rows[3].phases, [2]);
    assert.deepEqual(rows[3].visits, []);
  });

  test("a week with a Visit in the middle belongs to both Phases", () => {
    const visits = [{ id: "v", date: "2026-10-21", questionnaire: null, score: null }];
    const weeks = moodByWeek([], TMS_END, { today: TODAY, timeZone: TZ });
    assert.deepEqual(timelineRows(weeks, visits, phases(TMS_END, visits, TODAY))[2].phases, [1, 2]);
  });
});

describe("the declining Demo Patient", () => {
  const declining = generateDemoPatients({ today: TODAY }).find((p) => p.id === "demo-declining");
  const visits = declining.visits.map((v) => ({ id: v.id, ...v.data }));
  const checkIns = declining.checkIns.map((c) => c.data);
  const tmsEndDate = declining.patient.tmsEndDate;

  test("has two Phases split at week 3", () => {
    const result = phases(tmsEndDate, visits, TODAY);
    assert.deepEqual(
      result.map((p) => [p.number, p.startWeek, p.endWeek]),
      [
        [1, 1, 3],
        [2, 4, 6],
      ],
    );
  });

  test("has its Questionnaire point in week 3, at the Visit", () => {
    assert.deepEqual(
      questionnairePoints(visits, tmsEndDate).map((p) => [p.week, p.questionnaire, p.score]),
      [[3, "phq9", 9]],
    );
  });

  test("has a Mood rating in every week, on the 1 to 5 scale, lower at the end", () => {
    const weeks = moodByWeek(checkIns, tmsEndDate, { today: TODAY, timeZone: TZ });
    assert.equal(weeks.length, 6);
    assert.ok(weeks.every((w) => w.n > 0 && w.mean >= 1 && w.mean <= 5));
    assert.ok(weeks[5].mean < weeks[0].mean);
  });
});
