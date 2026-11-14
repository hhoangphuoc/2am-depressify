import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_QUOTES,
  MAX_QUOTE_CHARS,
  ratingText,
  selectSummary,
  shortQuotes,
  sortSummaries,
  summaryView,
  summaryWhen,
  voiceCueText,
} from "../js/lib/summaries.js";
import { generateDemoPatients } from "../../seed/src/generate.js";
import { zonedMillis } from "../../seed/src/dates.js";

const s = (id, createdAtMillis, extra = {}) => ({ id, checkInId: id, createdAtMillis, ...extra });

describe("sortSummaries", () => {
  test("lists newest first", () => {
    const sorted = sortSummaries([s("a", 100), s("c", 300), s("b", 200)]);
    assert.deepEqual(sorted.map((x) => x.id), ["c", "b", "a"]);
  });

  test("a Summary without a time goes last; ties keep a stable order by id, newest id first", () => {
    const sorted = sortSummaries([s("checkin-2026-11-01", null), s("checkin-2026-11-02", 5), s("checkin-2026-11-04", 5)]);
    assert.deepEqual(sorted.map((x) => x.id), ["checkin-2026-11-04", "checkin-2026-11-02", "checkin-2026-11-01"]);
  });

  test("does not change its input", () => {
    const input = [s("a", 1), s("b", 2)];
    sortSummaries(input);
    assert.deepEqual(input.map((x) => x.id), ["a", "b"]);
  });
});

describe("selectSummary", () => {
  const sorted = sortSummaries([s("a", 1), s("b", 2)]);

  test("selects the newest by default", () => {
    assert.equal(selectSummary(sorted, null).id, "b");
  });

  test("keeps the chosen one while it exists", () => {
    assert.equal(selectSummary(sorted, "a").id, "a");
  });

  test("falls back to the newest when the chosen one is gone", () => {
    assert.equal(selectSummary(sorted, "gone").id, "b");
  });

  test("nothing to select in an empty list", () => {
    assert.equal(selectSummary([], "a"), null);
  });
});

describe("shortQuotes", () => {
  test(`keeps at most ${MAX_QUOTES} quotes`, () => {
    assert.deepEqual(shortQuotes(["one", "two", "three", "four"]), ["one", "two", "three"]);
  });

  test(`cuts a quote longer than ${MAX_QUOTE_CHARS} characters`, () => {
    const [quote] = shortQuotes(["x".repeat(MAX_QUOTE_CHARS + 50)]);
    assert.ok(quote.length <= MAX_QUOTE_CHARS);
    assert.ok(quote.endsWith("…"));
  });

  test("drops empty and non-text entries before counting", () => {
    assert.deepEqual(shortQuotes(["", "  ", 42, null, " kept ", "b", "c", "d"]), ["kept", "b", "c"]);
  });

  test("no quotes is an empty list", () => {
    assert.deepEqual(shortQuotes(undefined), []);
  });
});

describe("ratingText and voiceCueText", () => {
  test("ratings stay on 1 to 5; anything else is not given", () => {
    assert.equal(ratingText(3), "3 of 5");
    assert.equal(ratingText(null), "Not given");
    assert.equal(ratingText(7), "Not given");
    assert.equal(ratingText(2.5), "Not given");
  });

  test("a Voice cue reads as an observation of what was heard", () => {
    assert.equal(
      voiceCueText({ label: "flat tone", intensity: 3, heard: "Short answers with long pauses" }),
      "Flat tone, noticed at 3 of 5: Short answers with long pauses",
    );
    assert.equal(voiceCueText({ label: "hesitation", intensity: null, heard: "" }), "Hesitation");
  });
});

describe("summaryWhen", () => {
  test("gives the day and time in the time zone", () => {
    const millis = zonedMillis("2026-11-13", 19, 42, "Europe/Helsinki");
    assert.equal(summaryWhen(millis, { today: "2026-11-14", timeZone: "Europe/Helsinki" }), "13 Nov, 19:42");
    assert.equal(summaryWhen(null, { today: "2026-11-14", timeZone: "Europe/Helsinki" }), "Date unknown");
  });
});

describe("summaryView", () => {
  test("gives every part the Summary shows, and nothing else", () => {
    const view = summaryView({
      checkInId: "checkin-1",
      createdAtMillis: 10,
      mood: 2,
      energy: null,
      sleepQuality: 4,
      sleepLine: "Slept about 6 hours last night.",
      themes: ["low energy", "", 3],
      voiceCues: [{ label: "quiet voice", intensity: 2, heard: "Spoke softly" }],
      suggestion: "A short walk.",
      previousOutcome: "Tried the music and felt better afterwards.",
      quotes: ["a", "b", "c", "d"],
      transcript: "never shown",
      audioUrl: "never shown",
    });
    assert.deepEqual(view, {
      id: "checkin-1",
      createdAtMillis: 10,
      ratings: [
        { name: "Mood", text: "2 of 5" },
        { name: "Energy", text: "Not given" },
        { name: "Sleep quality", text: "4 of 5" },
      ],
      sleepLine: "Slept about 6 hours last night.",
      themes: ["low energy"],
      suggestion: "A short walk.",
      previousOutcome: "Tried the music and felt better afterwards.",
      voiceCues: ["Quiet voice, noticed at 2 of 5: Spoke softly"],
      quotes: ["a", "b", "c"],
    });
  });

  test("a sparse Summary still shows", () => {
    const view = summaryView({ checkInId: "x" });
    assert.equal(view.id, "x");
    assert.deepEqual(view.themes, []);
    assert.equal(view.suggestion, null);
    assert.equal(view.previousOutcome, null);
  });
});

test("the Demo Patients' Summaries sort newest first with three quotes at most", () => {
  for (const p of generateDemoPatients({ today: "2026-11-14" })) {
    const sorted = sortSummaries(p.summaries.map((e) => ({ id: e.id, ...e.data })));
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i - 1].createdAtMillis >= sorted[i].createdAtMillis);
    for (const summary of sorted) assert.ok(summaryView(summary).quotes.length <= MAX_QUOTES);
  }
});
