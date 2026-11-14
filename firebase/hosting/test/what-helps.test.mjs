import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { WHAT_HELPS_WINDOW_DAYS, feelingGroup, feelingText, kindLabel, whatHelps, whatHelpsWindow } from "../js/lib/what-helps.js";
import { SUGGESTION_KINDS } from "../js/lib/contract.js";
import { generateDemoPatients } from "../../seed/src/generate.js";
import { zonedMillis } from "../../seed/src/dates.js";

const TZ = "Europe/Helsinki";
const TODAY = "2026-11-14";
const WINDOW = whatHelpsWindow(TODAY);

/** A Suggestion made at 19:00 Helsinki time on `date`. */
const sug = (kind, date, { tried = true, felt = 4, outcomeScore = 0.5, status = "accepted" } = {}) => ({
  kind,
  suggestedAtMillis: zonedMillis(date, 19, 0, TZ),
  status,
  tried,
  felt,
  outcomeScore,
});

describe("whatHelpsWindow", () => {
  test(`is the last ${WHAT_HELPS_WINDOW_DAYS} days, today included`, () => {
    assert.equal(WHAT_HELPS_WINDOW_DAYS, 28);
    assert.deepEqual(WINDOW, { start: "2026-10-18", end: TODAY, days: 28 });
  });
});

describe("whatHelps", () => {
  test("skips Suggestions with no Outcome score", () => {
    const { rows, waiting } = whatHelps(
      [sug("walk", "2026-11-10"), sug("music", "2026-11-11", { tried: null, felt: null, outcomeScore: null })],
      { ...WINDOW, timeZone: TZ },
    );
    assert.deepEqual(rows.map((r) => r.kind), ["walk"]);
    assert.equal(waiting, 1);
  });

  test("a declined Suggestion is neither counted nor waiting", () => {
    const { rows, waiting } = whatHelps([sug("walk", "2026-11-10", { status: "declined", tried: null, felt: null, outcomeScore: null })], {
      ...WINDOW,
      timeZone: TZ,
    });
    assert.deepEqual(rows, []);
    assert.equal(waiting, 0);
  });

  test("an answer the Patient preferred not to give is neither counted nor waiting", () => {
    const notSaid = sug("walk", "2026-11-10", { tried: null, felt: null, outcomeScore: null });
    const { rows, waiting } = whatHelps([{ ...notSaid, outcomeCheckInId: "checkin-2026-11-11" }], { ...WINDOW, timeZone: TZ });
    assert.deepEqual(rows, []);
    assert.equal(waiting, 0);
  });

  test("counts only the stated window, by the day the Suggestion was made", () => {
    const { rows } = whatHelps([sug("walk", "2026-10-17"), sug("walk", "2026-10-18"), sug("walk", TODAY), sug("walk", "2026-11-15")], {
      ...WINDOW,
      timeZone: TZ,
    });
    assert.equal(rows[0].n, 2);
  });

  test("sorts by mean Outcome, then by count, then by kind", () => {
    const { rows } = whatHelps(
      [
        sug("music", "2026-11-01", { outcomeScore: 0.2 }),
        sug("walk", "2026-11-02", { outcomeScore: 0.6 }),
        sug("nature", "2026-11-03", { outcomeScore: 0.6 }),
        sug("nature", "2026-11-04", { outcomeScore: 0.6 }),
        sug("daylight", "2026-11-05", { outcomeScore: 0.2 }),
        sug("breathing", "2026-11-06", { tried: false, felt: null, outcomeScore: -0.1 }),
      ],
      { ...WINDOW, timeZone: TZ },
    );
    assert.deepEqual(rows.map((r) => r.kind), ["nature", "walk", "daylight", "music", "breathing"]);
  });

  test("states counts and the reported feeling, never a percentage", () => {
    const { rows } = whatHelps(
      [
        sug("walk", "2026-11-01", { felt: 5 }),
        sug("walk", "2026-11-02", { felt: 4 }),
        sug("walk", "2026-11-03", { felt: 3 }),
        sug("walk", "2026-11-04", { felt: 1, outcomeScore: -0.6 }),
        sug("walk", "2026-11-05", { tried: false, felt: null, outcomeScore: -0.1 }),
        sug("walk", "2026-11-06", { felt: null, outcomeScore: 0.1 }),
      ],
      { ...WINDOW, timeZone: TZ },
    );
    const [walk] = rows;
    assert.equal(walk.n, 6);
    assert.equal(walk.label, "Walk");
    assert.deepEqual(walk.feelings, { better: 2, same: 1, notMuch: 1, notTried: 1, notSaid: 1 });
    assert.ok(!JSON.stringify(walk).includes("%"));
  });

  test("ignores unknown kinds and Suggestions without a time", () => {
    const { rows } = whatHelps([{ ...sug("walk", "2026-11-01"), kind: "skydiving" }, { ...sug("walk", "2026-11-01"), suggestedAtMillis: null }], {
      ...WINDOW,
      timeZone: TZ,
    });
    assert.deepEqual(rows, []);
  });
});

describe("feelingGroup and kindLabel", () => {
  test("group the Patient's 1 to 5 feeling into words", () => {
    assert.equal(feelingGroup({ tried: true, felt: 5 }), "better");
    assert.equal(feelingGroup({ tried: true, felt: 4 }), "better");
    assert.equal(feelingGroup({ tried: true, felt: 3 }), "same");
    assert.equal(feelingGroup({ tried: true, felt: 2 }), "notMuch");
    assert.equal(feelingGroup({ tried: false, felt: null }), "notTried");
    assert.equal(feelingGroup({ tried: true, felt: null }), "notSaid");
  });

  test("feelingText counts the Patient's answers in words and leaves out empty groups", () => {
    assert.equal(feelingText({ better: 3, same: 0, notMuch: 1, notTried: 1, notSaid: 0 }), "3 felt better, 1 did not help much, 1 not tried");
    assert.doesNotMatch(feelingText({ better: 1, same: 1, notMuch: 1, notTried: 1, notSaid: 1 }), /%/);
  });

  test("every kind has a label", () => {
    for (const kind of SUGGESTION_KINDS) assert.ok(kindLabel(kind));
    assert.equal(kindLabel("social_call"), "Calling someone");
  });
});

test("the Demo Patients give rows from scored Suggestions only", () => {
  for (const p of generateDemoPatients({ today: TODAY })) {
    const suggestions = p.suggestions.map((e) => e.data);
    const { rows } = whatHelps(suggestions, { ...WINDOW, timeZone: TZ });
    const scoredInWindow = suggestions.filter((s) => typeof s.outcomeScore === "number" && s.suggestedAtMillis >= zonedMillis(WINDOW.start, 0, 0, TZ));
    assert.equal(rows.reduce((sum, r) => sum + r.n, 0), scoredInWindow.length, p.id);
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i - 1].mean > rows[i].mean || (rows[i - 1].mean === rows[i].mean && rows[i - 1].n >= rows[i].n));
    }
  }
});
