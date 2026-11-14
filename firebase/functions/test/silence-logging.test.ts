// The silence check never logs the Patient's display name, the Clinician's address or anything else
// from the record, only ids and counts. Like test/alert-logging.test.ts, this taps every console
// method and both output streams before firebase-functions loads (its logger keeps its own
// reference to the console methods), then runs the real `silenceCheck` through its `run` entry
// point: a raise, a second run with the flag open, Patients skipped for each reason, and a failed
// transaction whose error message echoes the whole record. No captured line may contain the planted
// markers, and the log lines must carry the ids and counts.
import { beforeAll, describe, expect, it } from "vitest";

const captured: string[] = [];
const CONSOLE_METHODS = ["debug", "info", "log", "warn", "error", "trace", "dir"] as const;
for (const method of CONSOLE_METHODS) {
  const original = console[method].bind(console) as (...args: unknown[]) => void;
  console[method] = (...args: unknown[]) => {
    captured.push(args.map((a) => (typeof a === "string" ? a : safeJson(a))).join(" "));
    original(...args);
  };
}
for (const stream of [process.stdout, process.stderr]) {
  const original = stream.write.bind(stream) as (...args: unknown[]) => boolean;
  stream.write = ((chunk: unknown, ...rest: unknown[]) => {
    captured.push(String(chunk));
    return original(chunk, ...rest);
  }) as typeof stream.write;
}

function safeJson(value: unknown): string {
  try {
    return value instanceof Error ? `${value.name}: ${value.message} ${safeJson({ ...value })}` : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const NAME = "Name-Kestrel-4471";
const ADDRESS = "clinician-marker-5582@example.com";
const INTAKE = "Intake-Morrow-9903";
const REASON = "Reason-Tallis-3318 an earlier flag.";
const MARKERS = [NAME, ADDRESS, "clinician-marker-5582", INTAKE, "Reason-Tallis-3318"];

let runCheck: () => Promise<void>;

beforeAll(async () => {
  const { createSilenceFunctions } = await import("../src/silenceFunctions");
  const { FakeSilenceStore } = await import("./fakes");
  const { newPatientDoc } = await import("../src/types");
  const quietSince = Date.now() - 25 * 60 * 60 * 1000;
  const record = {
    ...newPatientDoc(NAME, ADDRESS),
    intakeHighlights: INTAKE,
    flagLevel: "amber" as const,
    flagReasons: [REASON],
    sharingConsent: "granted" as const,
    lastSeenAtMillis: quietSince,
  };
  const store = new FakeSilenceStore({
    "patient-quiet": record,
    "patient-broken": record,
    "patient-recent": { ...record, lastSeenAtMillis: Date.now() },
    "patient-off": { ...record, sharingConsent: "declined" },
    "patient-demo": { ...record, synthetic: true },
  });
  store.failFor.add("patient-broken");
  const { silenceCheck } = createSilenceFunctions({ store: () => store });
  runCheck = async () => {
    await silenceCheck.run({ scheduleTime: new Date().toISOString() } as Parameters<typeof silenceCheck.run>[0]);
  };
});

describe("no log line contains the display name, the address or anything else from the record", () => {
  it("the console tap sees firebase-functions logger output (positive control)", async () => {
    const logger = await import("firebase-functions/logger");
    const before = captured.length;
    logger.warn("canary-line-for-the-silence-tap");
    expect(captured.slice(before).join("\n")).toContain("canary-line-for-the-silence-tap");
  });

  it("silenceCheck through a raise, a second run, every skip and a failed transaction", async () => {
    const start = captured.length;
    await runCheck();
    await runCheck();

    const logs = captured.slice(start).join("\n");
    expect(logs).toContain("silenceCheck: raised");
    expect(logs).toContain("\"patientId\":\"patient-quiet\"");
    expect(logs).toMatch(/"flagId":"silent-\d+"/);
    expect(logs).toContain("silenceCheck: one Patient failed");
    expect(logs).toContain("\"patientId\":\"patient-broken\"");
    expect(logs).toContain("silenceCheck: done");
    expect(logs).toContain("\"raised\":1");
    expect(logs).toContain("\"alreadyFlagged\":1");
    expect(logs).toContain("\"notSharing\":1");
    expect(logs).toContain("\"synthetic\":1");
    for (const marker of MARKERS) expect(logs).not.toContain(marker);
  });
});
