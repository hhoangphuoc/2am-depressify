// The silence check's handler with an in-memory store, and the scheduled function's trigger. The
// pure rule is in test/silence.test.ts; the Admin SDK store and the email through `redFlagAlert`
// are in test/emulator/silence.test.ts.
import { describe, expect, it } from "vitest";
import { SCHEDULER_REGION } from "../src/region";
import { SILENT_REASON, silentFlagId } from "../src/silence";
import { createSilenceFunctions, silenceCheckHandler } from "../src/silenceFunctions";
import { newPatientDoc, type PatientDoc } from "../src/types";
import { FakeSilenceStore } from "./fakes";

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const QUIET_SINCE = NOW - 25 * HOUR;

function live(overrides: Partial<PatientDoc> = {}): PatientDoc {
  return { ...newPatientDoc("Alex Example", "clinician@example.com"), sharingConsent: "granted", lastSeenAtMillis: QUIET_SINCE, ...overrides };
}

describe("silenceCheckHandler", () => {
  it("gives a silent sharing Patient one red silent flag, stamped shared, and turns the record red", async () => {
    const store = new FakeSilenceStore({ quiet: live({ flagLevel: "amber", flagReasons: ["Mood was rated low three times."] }) });
    const result = await silenceCheckHandler(NOW, { store });

    expect(result).toMatchObject({ patients: 1, raised: 1, alreadyFlagged: 0, failed: 0 });
    expect([...store.flagsOf("quiet").entries()]).toEqual([
      [
        silentFlagId(QUIET_SINCE),
        { level: "red", kind: "silent", reason: SILENT_REASON, raisedAtMillis: NOW, clearedAtMillis: null, sharedWithClinician: true },
      ],
    ]);
    expect(store.patients.get("quiet")).toMatchObject({ flagLevel: "red", flagReasons: [SILENT_REASON, "Mood was rated low three times."] });
  });

  it("adds nothing on the next runs while the flag is open", async () => {
    const store = new FakeSilenceStore({ quiet: live() });
    await silenceCheckHandler(NOW, { store });
    const second = await silenceCheckHandler(NOW + HOUR, { store });
    const third = await silenceCheckHandler(NOW + 2 * HOUR, { store });

    expect(second).toMatchObject({ raised: 0, alreadyFlagged: 1 });
    expect(third).toMatchObject({ raised: 0, alreadyFlagged: 1 });
    expect(store.flagsOf("quiet").size).toBe(1);
    expect(store.patients.get("quiet")!.flagReasons).toEqual([SILENT_REASON]);
  });

  it("does not flag the same silence again after the Clinician cleared it, but does flag a new one", async () => {
    const store = new FakeSilenceStore({ quiet: live() });
    await silenceCheckHandler(NOW, { store });
    const flag = store.flagsOf("quiet").get(silentFlagId(QUIET_SINCE))!;
    store.flagsOf("quiet").set(silentFlagId(QUIET_SINCE), { ...flag, clearedAtMillis: NOW + HOUR });
    store.patients.set("quiet", { ...store.patients.get("quiet"), flagLevel: "green", flagReasons: [] });

    expect(await silenceCheckHandler(NOW + 2 * HOUR, { store })).toMatchObject({ raised: 0, alreadyFlagged: 1 });
    expect(store.patients.get("quiet")!.flagLevel).toBe("green");

    // The phone checks in, then goes quiet again for over 24 hours.
    const seenAgain = NOW + 3 * HOUR;
    store.patients.set("quiet", { ...store.patients.get("quiet"), lastSeenAtMillis: seenAgain });
    expect(await silenceCheckHandler(seenAgain + 25 * HOUR, { store })).toMatchObject({ raised: 1 });
    expect([...store.flagsOf("quiet").keys()]).toEqual([silentFlagId(QUIET_SINCE), silentFlagId(seenAgain)]);
  });

  it("gives nothing to a Patient seen 23 hours ago", async () => {
    const store = new FakeSilenceStore({ recent: live({ lastSeenAtMillis: NOW - 23 * HOUR }) });
    expect(await silenceCheckHandler(NOW, { store })).toMatchObject({ raised: 0, notSilent: 1 });
    expect(store.flagsOf("recent").size).toBe(0);
    expect(store.transactions).toBe(0);
  });

  it("gives nothing to a Patient who is not sharing, a synthetic Patient or one never seen", async () => {
    const store = new FakeSilenceStore({
      declined: live({ sharingConsent: "declined" }),
      undecided: live({ sharingConsent: "undecided" }),
      demo: live({ synthetic: true, healthSource: "synthetic" }),
      never: live({ lastSeenAtMillis: null }),
    });
    expect(await silenceCheckHandler(NOW, { store })).toEqual({
      patients: 4,
      raised: 0,
      alreadyFlagged: 0,
      notSilent: 1,
      notSharing: 2,
      synthetic: 1,
      failed: 0,
    });
    expect(store.transactions).toBe(0);
    for (const id of ["declined", "undecided", "demo", "never"]) {
      expect(store.flagsOf(id).size).toBe(0);
      expect(store.patients.get(id)!.flagLevel).toBe("green");
    }
  });

  it("re-checks the record inside the transaction: a phone seen or sharing withdrawn since the listing gets nothing", async () => {
    const store = new FakeSilenceStore({ seen: live(), withdrew: live() });
    store.beforeTransaction = (id, s) => {
      const p = s.patients.get(id)!;
      s.patients.set(id, id === "seen" ? { ...p, lastSeenAtMillis: NOW - HOUR } : { ...p, sharingConsent: "declined" });
    };
    expect(await silenceCheckHandler(NOW, { store })).toMatchObject({ raised: 0, notSilent: 1, notSharing: 1 });
    expect(store.flagsOf("seen").size + store.flagsOf("withdrew").size).toBe(0);
  });

  it("carries on past a Patient whose transaction fails, and counts it", async () => {
    const store = new FakeSilenceStore({ broken: live(), quiet: live() });
    store.failFor.add("broken");
    expect(await silenceCheckHandler(NOW, { store })).toMatchObject({ patients: 2, raised: 1, failed: 1 });
    expect(store.flagsOf("quiet").size).toBe(1);
  });
});

describe("the silenceCheck scheduled function", () => {
  const { silenceCheck } = createSilenceFunctions({ store: () => new FakeSilenceStore({}) });

  it("runs every hour on Helsinki time, in the EU region Cloud Scheduler supports", () => {
    expect(silenceCheck.__endpoint).toMatchObject({
      region: [SCHEDULER_REGION],
      scheduleTrigger: { schedule: "0 * * * *", timeZone: "Europe/Helsinki" },
    });
  });

  it("runs the check with the clock at run time", async () => {
    const store = new FakeSilenceStore({ quiet: live({ lastSeenAtMillis: Date.now() - 25 * HOUR }) });
    const { silenceCheck: fn } = createSilenceFunctions({ store: () => store });
    await fn.run({ scheduleTime: new Date().toISOString() } as Parameters<typeof fn.run>[0]);
    expect(store.flagsOf("quiet").size).toBe(1);
  });
});
