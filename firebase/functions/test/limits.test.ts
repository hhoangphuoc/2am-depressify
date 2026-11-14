// The hourly caps kept in patientLimits: pure, so no store.
import { describe, expect, it } from "vitest";
import {
  LIMIT_WINDOW_MS,
  MAX_CHECK_IN_STARTS_PER_HOUR,
  MAX_RED_FLAG_EMAILS_PER_HOUR,
  START_RECORD_KEEP_MS,
  storedStarts,
  withEmail,
  withStart,
} from "../src/limits";

const NOW = 1_700_000_000_000;
const start = (n: number, startedAtMillis = NOW) => ({ checkInId: `c${n}`, uid: "u1", startedAtMillis });

describe("withStart", () => {
  it("adds a start to a missing or malformed document", () => {
    expect(withStart(undefined, start(1))).toEqual([start(1)]);
    expect(withStart([{ checkInId: 7 }, "x", null], start(1))).toEqual([start(1)]);
  });

  it("refuses the start past the cap and counts only the last hour", () => {
    const full = Array.from({ length: MAX_CHECK_IN_STARTS_PER_HOUR }, (_, i) => start(i, NOW - 1_000));
    expect(withStart(full, start(99))).toBeNull();
    // Exactly an hour later the old starts no longer count toward the cap.
    expect(withStart(full, start(99, NOW - 1_000 + LIMIT_WINDOW_MS))).toEqual([...full, start(99, NOW - 1_000 + LIMIT_WINDOW_MS)]);
  });

  it("keeps a start for a day, so a finish retried hours later still finds its caller", () => {
    // A started at 10:00, the finish failed; someone else starts at 11:01; A's retry must still match.
    const a = start(1, NOW);
    const later = start(2, NOW + LIMIT_WINDOW_MS + 60_000);
    expect(withStart([a], later)).toEqual([a, later]);
    // After a day it is dropped, so the document stays small.
    const nextDay = start(3, NOW + START_RECORD_KEEP_MS);
    expect(withStart([a], nextDay)).toEqual([nextDay]);
  });

  it("storedStarts keeps starts of any age, for the finish check", () => {
    expect(storedStarts([start(1, NOW - 10 * LIMIT_WINDOW_MS), "x"])).toEqual([start(1, NOW - 10 * LIMIT_WINDOW_MS)]);
  });
});

describe("withEmail", () => {
  it("refuses the email past the cap and counts only the last hour", () => {
    const full = Array.from({ length: MAX_RED_FLAG_EMAILS_PER_HOUR }, () => NOW - 1_000);
    expect(withEmail(undefined, NOW)).toEqual([NOW]);
    expect(withEmail(full, NOW)).toBeNull();
    expect(withEmail([...full, "x"], NOW - 1_000 + LIMIT_WINDOW_MS)).toEqual([NOW - 1_000 + LIMIT_WINDOW_MS]);
  });
});
