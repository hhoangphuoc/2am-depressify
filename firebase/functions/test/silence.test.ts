// The pure parts of the silence check (#28): which Patients are silent, the flag it raises, the
// Patient update, and the plan that keeps it to one open silent flag. The handler and the scheduled
// function are in test/silence-handlers.test.ts.
import { describe, expect, it } from "vitest";
import { raisedAttention } from "../src/flags";
import {
  SILENCE_SCHEDULE,
  SILENCE_THRESHOLD_MILLIS,
  SILENCE_TIME_ZONE,
  SILENT_REASON,
  silenceDecision,
  silencePlan,
  silentFlag,
  silentFlagId,
} from "../src/silence";
import { newPatientDoc, type Flag, type PatientDoc } from "../src/types";

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

function patient(overrides: Partial<PatientDoc> = {}): PatientDoc {
  return {
    ...newPatientDoc("Alex Example", "clinician@example.com"),
    sharingConsent: "granted",
    lastSeenAtMillis: NOW - 25 * HOUR,
    ...overrides,
  };
}

function flag(overrides: Partial<Flag> = {}): Flag {
  return {
    level: "red",
    kind: "silent",
    reason: SILENT_REASON,
    raisedAtMillis: NOW - 2 * HOUR,
    clearedAtMillis: null,
    sharedWithClinician: true,
    ...overrides,
  };
}

describe("the schedule", () => {
  it("runs at the top of every hour, Helsinki time, with a 24-hour threshold", () => {
    expect(SILENCE_SCHEDULE).toBe("0 * * * *");
    expect(SILENCE_TIME_ZONE).toBe("Europe/Helsinki");
    expect(SILENCE_THRESHOLD_MILLIS).toBe(24 * HOUR);
  });
});

describe("silenceDecision: which Patients are silent", () => {
  it("a sharing live Patient last seen 25 hours ago is silent", () => {
    expect(silenceDecision(patient(), NOW)).toEqual({ silent: true, lastSeenAtMillis: NOW - 25 * HOUR });
  });

  it("one millisecond past 24 hours is silent", () => {
    expect(silenceDecision(patient({ lastSeenAtMillis: NOW - 24 * HOUR - 1 }), NOW)).toMatchObject({ silent: true });
  });

  it("exactly 24 hours is not yet silent: the rule is older than 24 hours", () => {
    expect(silenceDecision(patient({ lastSeenAtMillis: NOW - 24 * HOUR }), NOW)).toEqual({ silent: false, skip: "recent" });
  });

  it("23 hours is not silent", () => {
    expect(silenceDecision(patient({ lastSeenAtMillis: NOW - 23 * HOUR }), NOW)).toEqual({ silent: false, skip: "recent" });
  });

  it("a Patient never seen (null) is not silent", () => {
    expect(silenceDecision(patient({ lastSeenAtMillis: null }), NOW)).toEqual({ silent: false, skip: "never_seen" });
  });

  it("a missing or malformed last sign of life counts as never seen", () => {
    const { lastSeenAtMillis: _drop, ...noField } = patient();
    expect(silenceDecision(noField, NOW)).toEqual({ silent: false, skip: "never_seen" });
    expect(silenceDecision(patient({ lastSeenAtMillis: "yesterday" as unknown as number }), NOW)).toEqual({ silent: false, skip: "never_seen" });
    expect(silenceDecision(patient({ lastSeenAtMillis: Number.NaN }), NOW)).toEqual({ silent: false, skip: "never_seen" });
  });

  it("a last sign of life in the future (a phone clock ahead) is not silent", () => {
    expect(silenceDecision(patient({ lastSeenAtMillis: NOW + 3 * HOUR }), NOW)).toEqual({ silent: false, skip: "future" });
  });

  it("a Patient who declined, withdrew or never decided sharing is skipped", () => {
    for (const sharingConsent of ["declined", "undecided"] as const) {
      expect(silenceDecision(patient({ sharingConsent }), NOW)).toEqual({ silent: false, skip: "not_sharing" });
    }
    expect(silenceDecision({ lastSeenAtMillis: NOW - 30 * HOUR }, NOW)).toEqual({ silent: false, skip: "not_sharing" });
  });

  it("a synthetic Patient is never silent, however long ago it was seen", () => {
    expect(silenceDecision(patient({ synthetic: true, lastSeenAtMillis: NOW - 400 * HOUR }), NOW)).toEqual({ silent: false, skip: "synthetic" });
  });

  it("no record is skipped", () => {
    expect(silenceDecision(undefined, NOW)).toEqual({ silent: false, skip: "no_patient" });
  });
});

describe("the flag", () => {
  it("is red, kind silent, worded as a quiet phone, uncleared and stamped with sharingStamp", () => {
    expect(silentFlag(patient(), NOW)).toEqual({
      level: "red",
      kind: "silent",
      reason: SILENT_REASON,
      raisedAtMillis: NOW,
      clearedAtMillis: null,
      sharedWithClinician: true,
    });
  });

  it("the reason says the phone has been quiet and nothing about self-harm, risk or the Patient", () => {
    expect(SILENT_REASON).toBe("The phone has been quiet: it has not connected for over 24 hours.");
    expect(SILENT_REASON).not.toMatch(/harm|risk|crisis|suicid|safe|danger|life|alive|dead|mood|depress|\d+\s*%|score/i);
  });

  it("has one id per silence episode, from the last sign of life, so a retry never duplicates it", () => {
    expect(silentFlagId(1_731_571_200_000)).toBe("silent-1731571200000");
    expect(silentFlagId(1_731_571_200_000)).toBe(silentFlagId(1_731_571_200_000));
    expect(silentFlagId(1_731_571_200_001)).not.toBe(silentFlagId(1_731_571_200_000));
  });
});

describe("raisedAttention: the Patient's level and reasons, only ever raised", () => {
  it("green goes red with the reason", () => {
    expect(raisedAttention(patient(), flag())).toEqual({ flagLevel: "red", flagReasons: [SILENT_REASON] });
  });

  it("amber goes red; the red reason comes first and the amber ones are kept", () => {
    const before = patient({ flagLevel: "amber", flagReasons: ["Mood was rated low three times."] });
    expect(raisedAttention(before, flag())).toEqual({ flagLevel: "red", flagReasons: [SILENT_REASON, "Mood was rated low three times."] });
  });

  it("red stays red and the earlier reasons are kept after the newest red", () => {
    const before = patient({ flagLevel: "red", flagReasons: ["A crisis was raised in a Check-in.", "Mood was rated low three times."] });
    expect(raisedAttention(before, flag())).toEqual({
      flagLevel: "red",
      flagReasons: [SILENT_REASON, "A crisis was raised in a Check-in.", "Mood was rated low three times."],
    });
  });

  it("never lists a reason twice", () => {
    const before = patient({ flagLevel: "red", flagReasons: ["Other.", SILENT_REASON] });
    expect(raisedAttention(before, flag()).flagReasons).toEqual([SILENT_REASON, "Other."]);
  });

  it("an amber flag never lowers a red level", () => {
    const before = patient({ flagLevel: "red", flagReasons: ["A crisis was raised in a Check-in."] });
    expect(raisedAttention(before, flag({ level: "amber", reason: "Amber." }))).toEqual({
      flagLevel: "red",
      flagReasons: ["A crisis was raised in a Check-in.", "Amber."],
    });
  });

  it("a malformed level or reasons list is read as green with no reasons", () => {
    const before = { flagLevel: "purple", flagReasons: "nope" } as unknown as Partial<PatientDoc>;
    expect(raisedAttention(before, flag())).toEqual({ flagLevel: "red", flagReasons: [SILENT_REASON] });
  });
});

describe("silencePlan: what one Patient's transaction writes", () => {
  const lastSeen = NOW - 25 * HOUR;

  it("raises the flag at the episode's id and the Patient update, for a silent Patient with no silent flags", () => {
    expect(silencePlan(patient({ flagLevel: "amber", flagReasons: ["Amber."] }), [], NOW)).toEqual({
      raise: true,
      flagId: silentFlagId(lastSeen),
      flag: silentFlag(patient(), NOW),
      update: { flagLevel: "red", flagReasons: [SILENT_REASON, "Amber."] },
    });
  });

  it("raises nothing while an earlier silent flag is still open", () => {
    const open = [{ id: "silent-123", flag: flag({ raisedAtMillis: NOW - 50 * HOUR }) }];
    expect(silencePlan(patient(), open, NOW)).toEqual({ raise: false, skip: "already_open" });
  });

  it("raises nothing again for the same episode, even after the Clinician cleared its flag", () => {
    const cleared = [{ id: silentFlagId(lastSeen), flag: flag({ clearedAtMillis: NOW - HOUR }) }];
    expect(silencePlan(patient(), cleared, NOW)).toEqual({ raise: false, skip: "episode_flagged" });
  });

  it("a cleared flag from an earlier episode does not block a new one", () => {
    const earlier = [{ id: "silent-1000", flag: flag({ raisedAtMillis: 1000, clearedAtMillis: 2000 }) }];
    expect(silencePlan(patient(), earlier, NOW)).toMatchObject({ raise: true, flagId: silentFlagId(lastSeen) });
  });

  it("an open silent flag stamped false (raised while not sharing) does not block a shared one", () => {
    const hidden = [{ id: "silent-1000", flag: flag({ sharedWithClinician: false }) }];
    expect(silencePlan(patient(), hidden, NOW)).toMatchObject({ raise: true });
  });

  it("re-checks the fresh record: not sharing, synthetic, seen again or gone means nothing is written", () => {
    expect(silencePlan(patient({ sharingConsent: "declined" }), [], NOW)).toEqual({ raise: false, skip: "not_sharing" });
    expect(silencePlan(patient({ synthetic: true }), [], NOW)).toEqual({ raise: false, skip: "synthetic" });
    expect(silencePlan(patient({ lastSeenAtMillis: NOW - HOUR }), [], NOW)).toEqual({ raise: false, skip: "recent" });
    expect(silencePlan(undefined, [], NOW)).toEqual({ raise: false, skip: "no_patient" });
  });

  it("ignores flags of other kinds", () => {
    const others = [{ id: "crisis-1", flag: flag({ kind: "crisis" }) }];
    expect(silencePlan(patient(), others, NOW)).toMatchObject({ raise: true });
  });
});
