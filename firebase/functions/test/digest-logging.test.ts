// Nothing logs Summary text, quotes, the prompt or the Digest text (ADR 0006 applies to the Digest
// too). Like test/intake-logging.test.ts, this taps every console method and both output streams
// before firebase-functions loads, then runs generateDigest through the real callable HTTP layer
// (success, model failure, empty output, a failed write, refusals, bad requests) and the scheduled
// weeklyDigest through its `run` entry point. No captured line may contain the week's data, the
// prompt or the model's text, and neither may any error the client receives.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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

// Let the callable accept unsigned ID tokens, as it does under the Functions emulator.
process.env.FIREBASE_DEBUG_MODE = "true";
process.env.FIREBASE_DEBUG_FEATURES = JSON.stringify({ skipTokenVerification: true });

// Markers planted in every free-text part of the week's data and in the model's reply.
const THEME = "Theme-Zarvex-1187";
const QUOTE = "Quote-Moltrin-5521";
const SLEEP = "Sleep-Ostrava-3390";
const SUGGESTION = "Suggestion-Pellam-7702";
const CUE = "Cue-Trindle-4410";
const MODEL_REPLY = "Reply-Vossik-9034 The Patient rated mood low.";
const MARKERS = [THEME, QUOTE, SLEEP, SUGGESTION, CUE, "Reply-Vossik-9034"];

function idToken(claims: Record<string, unknown>): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "none", typ: "JWT" })}.${part(claims)}.sig`;
}

/** A Clinician's account as allow-clinician leaves it (ADR 0010). */
const CLINICIAN_CLAIMS = { email_verified: true, role: "clinician", firebase: { sign_in_provider: "password" } };
const CLINICIAN_TOKEN = idToken({ sub: "clinician-uid", email: "clinician@example.com", ...CLINICIAN_CLAIMS });
const OTHER_TOKEN = idToken({ sub: "other-uid", email: "other-clinician@example.com", ...CLINICIAN_CLAIMS });

let server: Server;
let baseUrl = "";
let scenario: "ok" | "fails" | "empty" | "write-fails" = "ok";
let instructionText = "";
let runWeekly: (scheduleTime: string) => Promise<void>;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { createDigestFunctions } = await import("../src/digestFunctions");
  const { DIGEST_SYSTEM_INSTRUCTION } = await import("../src/digest");
  const { FakeDigestStore, FakeTextModel, failingTextModel } = await import("./fakes");
  const { newPatientDoc } = await import("../src/types");
  instructionText = DIGEST_SYSTEM_INSTRUCTION.split("\n")[0]!;

  const now = Date.now();
  const summary = {
    checkInId: "checkin-1",
    createdAtMillis: now - 60_000,
    mood: 2,
    energy: 2,
    sleepQuality: 2,
    sleepLine: SLEEP,
    themes: [THEME],
    voiceCues: [{ label: CUE, intensity: 3, heard: CUE }],
    suggestion: SUGGESTION,
    previousOutcome: SUGGESTION,
    quotes: [QUOTE],
    sharedWithClinician: true,
  };
  const patient = { ...newPatientDoc("Logging patient", "clinician@example.com"), sharingConsent: "granted" as const };
  const store = () => {
    const s = new FakeDigestStore({ "patient-1": { patient, summaries: [summary], days: [] } });
    if (scenario === "write-fails") s.failWritesFor.add("patient-1");
    return s;
  };

  const { generateDigest, weeklyDigest } = createDigestFunctions({
    store,
    textModel: () => {
      if (scenario === "fails") return failingTextModel(500);
      if (scenario === "empty") return new FakeTextModel("");
      return new FakeTextModel(MODEL_REPLY);
    },
  });
  runWeekly = async (scheduleTime) => {
    await weeklyDigest.run({ scheduleTime } as Parameters<typeof weeklyDigest.run>[0]);
  };

  const app = express();
  app.use(express.json({ limit: "1mb", verify: (req, _res, buf) => Object.assign(req, { rawBody: buf }) }));
  type FunctionRequest = Parameters<typeof generateDigest>[0];
  app.post("/generateDigest", (req, res) => generateDigest(req as FunctionRequest, res));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
});

beforeEach(() => {
  scenario = "ok";
});

async function call(data: unknown, token?: string): Promise<{ status: number; text: string }> {
  const response = await fetch(`${baseUrl}/generateDigest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ data }),
  });
  return { status: response.status, text: await response.text() };
}

function expectClean(text: string) {
  for (const marker of MARKERS) expect(text).not.toContain(marker);
  expect(text).not.toContain(instructionText);
  expect(text).not.toContain("<week_data>");
}

describe("no log line and no client error contains the week's data, the prompt or the Digest", () => {
  it("the console tap sees firebase-functions logger output (positive control)", async () => {
    const logger = await import("firebase-functions/logger");
    const before = captured.length;
    logger.warn("canary-line-for-the-digest-tap");
    expect(captured.slice(before).join("\n")).toContain("canary-line-for-the-digest-tap");
  });

  it("generateDigest through success, failures, refusals and bad requests", async () => {
    const start = captured.length;
    const responses: { status: number; text: string }[] = [];
    const data = { patientId: "patient-1" };

    scenario = "ok";
    responses.push(await call(data, CLINICIAN_TOKEN));
    scenario = "fails";
    responses.push(await call(data, CLINICIAN_TOKEN));
    scenario = "empty";
    responses.push(await call(data, CLINICIAN_TOKEN));
    scenario = "write-fails";
    responses.push(await call(data, CLINICIAN_TOKEN));
    scenario = "ok";
    responses.push(await call(data, OTHER_TOKEN));
    responses.push(await call(data));
    responses.push(await call({ patientId: "nobody" }, CLINICIAN_TOKEN));
    responses.push(await call({ patientId: "" }, CLINICIAN_TOKEN));

    expect(responses.map((r) => r.status)).toEqual([200, 503, 503, 503, 403, 401, 403, 400]);
    // The success returns the Digest to its caller (the Clinician) and nowhere else.
    expect(JSON.parse(responses[0]!.text).result.digest.text).toBe(MODEL_REPLY);

    const logs = captured.slice(start).join("\n");
    expect(logs).toContain("generateDigest: failed"); // the failure paths logged
    expectClean(logs);
    for (const response of responses.slice(1)) expectClean(response.text);
  });

  it("weeklyDigest through success and a failing model", async () => {
    const start = captured.length;
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();

    scenario = "ok";
    await runWeekly(nextWeek);
    scenario = "fails";
    await runWeekly(nextWeek);

    const logs = captured.slice(start).join("\n");
    expect(logs).toContain("weeklyDigest: done");
    expect(logs).toContain("weeklyDigest: one Patient failed");
    expectClean(logs);
  });
});
