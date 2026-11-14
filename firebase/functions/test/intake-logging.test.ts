// The report text is never logged (ADR 0006 applies to the Intake too). This test taps every
// console method and both output streams before firebase-functions loads (its logger keeps its own
// reference to the console methods), then runs full extracts through the real callable HTTP layer:
// success, model failure, empty output, refusals and malformed requests. No captured line may
// contain the report text, and neither may any error the client receives.
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

const REPORT_MARKER = "Quillon-7743";
const REPORT = `FICTIONAL test report ${REPORT_MARKER}. Walks the dog Pepper at dawn and sings in a choir.`;

/** An unsigned ID token; the callable decodes it without verifying in debug mode. */
function idToken(claims: Record<string, unknown>): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "none", typ: "JWT" })}.${part(claims)}.sig`;
}

const CLINICIAN_TOKEN = idToken({ sub: "clinician-uid", email: "clinician@example.com" });
const OTHER_TOKEN = idToken({ sub: "other-uid", email: "other-clinician@example.com" });

let server: Server;
let baseUrl = "";
let scenario: "ok" | "fails" | "empty" | "over-limit" = "ok";
let modelCalls = 0;

beforeAll(async () => {
  const express = (await import("express")).default;
  const { createIntakeFunctions } = await import("../src/intakeFunctions");
  const { FakePatientStore, FakeTextModel, failingTextModel, words } = await import("./fakes");

  const patients = new FakePatientStore();
  const { extractIntake, saveIntake } = createIntakeFunctions({
    patients: () => patients,
    textModel: () => {
      modelCalls += 1;
      if (scenario === "fails") return failingTextModel(500);
      if (scenario === "empty") return new FakeTextModel("");
      if (scenario === "over-limit") return new FakeTextModel(`${words(130)} ${REPORT_MARKER}`);
      return new FakeTextModel("- Walks the dog at dawn.\n- Sings in a choir.");
    },
  });

  const app = express();
  // Cloud Functions hands the callable a parsed body plus the raw bytes.
  app.use(express.json({ limit: "1mb", verify: (req, _res, buf) => Object.assign(req, { rawBody: buf }) }));
  type FunctionRequest = Parameters<typeof extractIntake>[0];
  app.post("/extractIntake", (req, res) => extractIntake(req as FunctionRequest, res));
  app.post("/saveIntake", (req, res) => saveIntake(req as FunctionRequest, res));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
});

beforeEach(() => {
  scenario = "ok";
  modelCalls = 0;
});

async function call(name: string, data: unknown, token?: string): Promise<{ status: number; text: string }> {
  const response = await fetch(`${baseUrl}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ data }),
  });
  return { status: response.status, text: await response.text() };
}

describe("no log line and no client error contains the report", () => {
  it("the console tap sees firebase-functions logger output (positive control)", async () => {
    const logger = await import("firebase-functions/logger");
    const before = captured.length;
    logger.warn("canary-line-for-the-tap");
    expect(captured.slice(before).join("\n")).toContain("canary-line-for-the-tap");
  });

  it("through success, failure, empty output, refusals and bad requests", async () => {
    const start = captured.length;
    const responses: { status: number; text: string }[] = [];
    const data = { patientId: "patient-1", reportText: REPORT };

    scenario = "ok";
    responses.push(await call("extractIntake", data, CLINICIAN_TOKEN));
    scenario = "over-limit";
    responses.push(await call("extractIntake", data, CLINICIAN_TOKEN));
    scenario = "fails";
    responses.push(await call("extractIntake", data, CLINICIAN_TOKEN));
    scenario = "empty";
    responses.push(await call("extractIntake", data, CLINICIAN_TOKEN));
    scenario = "ok";
    responses.push(await call("extractIntake", data, OTHER_TOKEN));
    responses.push(await call("extractIntake", data));
    responses.push(await call("extractIntake", { patientId: "nobody", reportText: REPORT }, CLINICIAN_TOKEN));
    responses.push(await call("extractIntake", { patientId: "", reportText: REPORT }, CLINICIAN_TOKEN));
    responses.push(await call("extractIntake", { ...data, extra: REPORT }, CLINICIAN_TOKEN));
    responses.push(await call("saveIntake", { patientId: "patient-1", highlights: REPORT.repeat(10) }, CLINICIAN_TOKEN));

    // The calls happened and took the expected paths.
    expect(responses.map((r) => r.status)).toEqual([200, 200, 503, 503, 403, 401, 403, 400, 200, 400]);
    expect(JSON.parse(responses[0]!.text).result.highlights).toContain("Walks the dog");

    const logs = captured.slice(start).join("\n");
    expect(logs).toContain("extractIntake: the text model call failed"); // the failure path logged
    expect(logs).not.toContain(REPORT_MARKER);
    expect(logs).not.toContain("Pepper");

    // What the client receives on errors names no part of the report either.
    for (const response of responses.filter((r) => r.status !== 200)) {
      expect(response.text).not.toContain(REPORT_MARKER);
      expect(response.text).not.toContain("Pepper");
    }
  });
});
