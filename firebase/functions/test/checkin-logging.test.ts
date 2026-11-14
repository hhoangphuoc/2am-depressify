// The transcript, the Brief and the token are never logged (ADR 0006). This test taps every console
// method and both output streams before firebase-functions loads (its logger keeps its own reference
// to the console methods), then runs full Check-ins through the real callable HTTP layer: start,
// then finish with success, a model failure, malformed output, a write failure, a token failure,
// refusals and bad requests. No captured line may contain the transcript, the Brief or the token,
// and neither may any error the client receives.
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

const TRANSCRIPT_MARKER = "Quillon-7743";
const BRIEF_MARKER = "Brief-Marker-5521";
const TOKEN_MARKER = "tok-Zephyr-9001";
const PATIENT_ID = "patient-1";

const DRAFT = {
  turns: [
    { speaker: "companion", text: "How was the walk with Pepper?" },
    { speaker: "patient", text: `FICTIONAL ${TRANSCRIPT_MARKER}: I walked the dog Pepper at dawn and sang in the choir.` },
  ],
  voiceCues: [{ label: "bright tone", intensity: 2, heard: `laughed about ${TRANSCRIPT_MARKER}` }],
  suggestions: [{ details: `Sing with ${TRANSCRIPT_MARKER} again`, status: "accepted" }],
  crisis: false,
};
const BRIEF = `Fictional Brief ${BRIEF_MARKER}: the Patient walks the dog Pepper.`;

/** An unsigned ID token; the callable decodes it without verifying in debug mode. */
function idToken(claims: Record<string, unknown>): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "none", typ: "JWT" })}.${part(claims)}.sig`;
}

const PATIENT_TOKEN = idToken({ sub: PATIENT_ID, user_id: PATIENT_ID });
const OTHER_TOKEN = idToken({ sub: "other-uid", user_id: "other-uid" });

let server: Server;
let baseUrl = "";
let scenario: "ok" | "model-fails" | "malformed" | "write-fails" | "token-fails" = "ok";
let store: import("./fakes").FakeCheckInStore;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { createCheckInFunctions } = await import("../src/checkInFunctions");
  const { FakeCheckInStore, FakeLiveTokens, FakeTextModel, failingTextModel } = await import("./fakes");

  store = new FakeCheckInStore();
  const { startCheckIn, finishCheckIn } = createCheckInFunctions({
    store: () => {
      store.failWrites = scenario === "write-fails";
      return store;
    },
    textModel: () => {
      if (scenario === "model-fails") return failingTextModel(500);
      if (scenario === "malformed") return new FakeTextModel(`{"themes": ["${TRANSCRIPT_MARKER}"`);
      return new FakeTextModel(JSON.stringify({ themes: ["Dog walks", "Choir"], quotes: [`FICTIONAL ${TRANSCRIPT_MARKER}`], mood: 4 }));
    },
    liveTokens: () => {
      const tokens = new FakeLiveTokens();
      if (scenario === "token-fails") tokens.fail = 400;
      return { createToken: async (request) => (await tokens.createToken(request)).replace("fake-token", TOKEN_MARKER) };
    },
  });

  const app = express();
  // Cloud Functions hands the callable a parsed body plus the raw bytes.
  app.use(express.json({ limit: "10mb", verify: (req, _res, buf) => Object.assign(req, { rawBody: buf }) }));
  type FunctionRequest = Parameters<typeof startCheckIn>[0];
  app.post("/startCheckIn", (req, res) => startCheckIn(req as FunctionRequest, res));
  app.post("/finishCheckIn", (req, res) => finishCheckIn(req as FunctionRequest, res));
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

async function call(name: string, data: unknown, token?: string): Promise<{ status: number; text: string }> {
  const response = await fetch(`${baseUrl}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ data }),
  });
  return { status: response.status, text: await response.text() };
}

async function startOne(): Promise<string> {
  const response = await call("startCheckIn", { patientId: PATIENT_ID, brief: BRIEF, mode: "typed" }, PATIENT_TOKEN);
  expect(response.status).toBe(200);
  return JSON.parse(response.text).result.checkInId;
}

describe("no log line and no client error contains the transcript, the Brief or the token", () => {
  it("the console tap sees firebase-functions logger output (positive control)", async () => {
    const logger = await import("firebase-functions/logger");
    const before = captured.length;
    logger.warn("canary-line-for-the-tap");
    expect(captured.slice(before).join("\n")).toContain("canary-line-for-the-tap");
  });

  it("through start, finish, failures, fallbacks, refusals and bad requests", async () => {
    const start = captured.length;
    const responses: { name: string; status: number; text: string }[] = [];
    const record = async (name: string, data: unknown, token?: string) => responses.push({ name, ...(await call(name, data, token)) });

    // Start: success, a failed token request, refusals and bad input.
    const first = await startOne();
    scenario = "token-fails";
    await record("startCheckIn", { patientId: PATIENT_ID, brief: BRIEF }, PATIENT_TOKEN);
    scenario = "ok";
    await record("startCheckIn", { patientId: PATIENT_ID, brief: BRIEF }, OTHER_TOKEN);
    await record("startCheckIn", { patientId: PATIENT_ID, brief: BRIEF });
    await record("startCheckIn", { patientId: PATIENT_ID, brief: `${BRIEF}${"x".repeat(20_000)}` }, PATIENT_TOKEN);

    // Finish: success, then each failure on a fresh Check-in.
    const data = (checkInId: string) => ({ patientId: PATIENT_ID, checkInId, draft: DRAFT, todayLines: [`Sleep ${TRANSCRIPT_MARKER}`] });
    await record("finishCheckIn", data(first), PATIENT_TOKEN);
    for (const failure of ["model-fails", "malformed", "write-fails"] as const) {
      const checkInId = await startOne();
      scenario = failure;
      await record("finishCheckIn", data(checkInId), PATIENT_TOKEN);
      scenario = "ok";
    }
    await record("finishCheckIn", data(first), OTHER_TOKEN);
    await record("finishCheckIn", data(first));
    await record("finishCheckIn", data("never-started"), PATIENT_TOKEN);
    await record("finishCheckIn", { ...data(first), checkInId: "" }, PATIENT_TOKEN);
    await record("finishCheckIn", { ...data(first), draft: `Patient: ${TRANSCRIPT_MARKER}` }, PATIENT_TOKEN);

    // The calls happened and took the expected paths.
    expect(responses.map((r) => `${r.name} ${r.status}`)).toEqual([
      "startCheckIn 503",
      "startCheckIn 403",
      "startCheckIn 401",
      "startCheckIn 400",
      "finishCheckIn 200",
      "finishCheckIn 200", // model failure: minimal Summary
      "finishCheckIn 200", // malformed output: minimal Summary
      "finishCheckIn 503", // write failure
      "finishCheckIn 403",
      "finishCheckIn 401",
      "finishCheckIn 404",
      "finishCheckIn 400",
      "finishCheckIn 400",
    ]);
    const ok = JSON.parse(responses[4]!.text).result;
    expect(ok.summary.themes).toEqual(["Dog walks", "Choir"]);
    expect(JSON.parse(responses[5]!.text).result.minimal).toBe(true);
    expect(JSON.parse(responses[6]!.text).result.minimal).toBe(true);

    const logs = captured.slice(start).join("\n");
    // The failure paths logged.
    expect(logs).toContain("startCheckIn: the Live token request failed");
    expect(logs).toContain("finishCheckIn: the text model call failed");
    expect(logs).toContain("finishCheckIn: the text model's reply was not usable");
    expect(logs).toContain("finishCheckIn: could not save the Summary");
    for (const secret of [TRANSCRIPT_MARKER, "Pepper", "choir", BRIEF_MARKER, TOKEN_MARKER, "auth_tokens/"]) {
      expect(logs).not.toContain(secret);
    }

    // What the client receives on errors names no part of the draft or the Brief either.
    for (const response of responses.filter((r) => r.status !== 200)) {
      for (const secret of [TRANSCRIPT_MARKER, "Pepper", BRIEF_MARKER, TOKEN_MARKER]) expect(response.text).not.toContain(secret);
    }

    // Nothing written holds the transcript: only the Summary (which may quote the Patient's own
    // words, as the spec allows), the Check-in's fields and the Patient's times.
    const paths = new Set(store.writes.map((w) => w.path.replace(/\/[^/]+$/, "/*")));
    expect([...paths].sort()).toEqual([`patients/${PATIENT_ID}/checkIns/*`, `patients/${PATIENT_ID}/summaries/*`, "patients/*"].sort());
    const written = JSON.stringify(store.writes);
    expect(written).not.toContain("How was the walk with Pepper");
    expect(written).not.toContain("sang in the choir");
    expect(written).not.toContain(BRIEF_MARKER);
    expect(written).not.toContain(TOKEN_MARKER);
  });
});
