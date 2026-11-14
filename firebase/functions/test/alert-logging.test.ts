// The red flag alert never logs the flag's reason, the Patient's display name, the Clinician's
// address or the email. Like test/intake-logging.test.ts, this taps every console method and both
// output streams before firebase-functions loads (its logger keeps its own reference to the console
// methods), then runs the real `redFlagAlert` trigger through its `run` entry point: a sent email,
// a duplicate delivery, an amber flag, a Patient not sharing, and failed reads and writes. No
// captured line may contain the planted markers, and the log lines must carry the outcome.
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

const REASON = "Reason-Quillon-6614 said something in a Check-in.";
const NAME = "Name-Bratsk-2290";
const ADDRESS = "clinician-marker-7731@example.com";
const MARKERS = ["Reason-Quillon-6614", NAME, ADDRESS, "clinician-marker-7731"];

type Scenario = "ok" | "not-sharing" | "read-fails" | "write-fails";
let scenario: Scenario = "ok";
let run: (flagId: string, flag: Record<string, unknown>) => Promise<void>;
let sentSubjects: string[] = [];

beforeAll(async () => {
  const { createAlertFunctions } = await import("../src/alertFunctions");
  const { FakeAlertStore } = await import("./fakes");
  const { newPatientDoc } = await import("../src/types");
  const sharing = { ...newPatientDoc(NAME, ADDRESS), sharingConsent: "granted" as const };
  const shared = new FakeAlertStore({ "patient-1": sharing });

  const { redFlagAlert } = createAlertFunctions({
    store: () => {
      if (scenario === "not-sharing") return new FakeAlertStore({ "patient-1": { ...sharing, sharingConsent: "declined" } });
      const store = scenario === "ok" ? shared : new FakeAlertStore({ "patient-1": sharing });
      store.failReads = scenario === "read-fails";
      store.failWrites = scenario === "write-fails";
      return store;
    },
    dashboardUrl: () => "https://dashboard.example.test",
  });
  run = async (flagId, flag) => {
    const event = { params: { patientId: "patient-1", flagId }, data: { data: () => flag } };
    await redFlagAlert.run(event as unknown as Parameters<typeof redFlagAlert.run>[0]);
    sentSubjects = [...shared.mail.values()].map((m) => m.message.subject);
  };
});

const red = { level: "red", kind: "crisis", reason: REASON, raisedAtMillis: 1, clearedAtMillis: null, sharedWithClinician: true };

describe("no log line contains the reason, the display name, the address or the email", () => {
  it("the console tap sees firebase-functions logger output (positive control)", async () => {
    const logger = await import("firebase-functions/logger");
    const before = captured.length;
    logger.warn("canary-line-for-the-alert-tap");
    expect(captured.slice(before).join("\n")).toContain("canary-line-for-the-alert-tap");
  });

  it("redFlagAlert through sent, duplicate, amber, not sharing, and failed read and write", async () => {
    const start = captured.length;

    scenario = "ok";
    await run("flag-1", red);
    await run("flag-1", red);
    await run("flag-2", { ...red, level: "amber", kind: "low_mood" });
    scenario = "not-sharing";
    await run("flag-3", red);
    scenario = "read-fails";
    await expect(run("flag-4", red)).rejects.toThrow("redFlagAlert failed");
    scenario = "write-fails";
    await expect(run("flag-5", red)).rejects.toThrow("redFlagAlert failed");

    // The email itself does carry the name and the reason; only the logs must not.
    expect(sentSubjects).toHaveLength(1);
    expect(sentSubjects[0]).toContain(NAME);

    const logs = captured.slice(start).join("\n");
    expect(logs).toContain("\"outcome\":\"sent\"");
    expect(logs).toContain("\"outcome\":\"duplicate\"");
    expect(logs).toContain("\"skip\":\"not_red\"");
    expect(logs).toContain("\"skip\":\"not_sharing\"");
    expect(logs).toContain("redFlagAlert: failed, will retry");
    expect(logs).toContain("\"kind\":\"crisis\"");
    for (const marker of MARKERS) expect(logs).not.toContain(marker);
  });
});
