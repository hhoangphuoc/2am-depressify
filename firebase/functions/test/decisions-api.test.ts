// The real Decisions client with a fake `fetch`: the recorded request shape, the key in the header,
// one attempt with a timeout, and errors that carry a status and a code word but never the body.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DECISIONS_URL, DecisionsError, errorCodeOf, fetchDecisionsClient } from "../src/decisionsApi";
import { buildDecisionsRequest } from "../src/decisions";

const SPIKE = join(__dirname, "..", "..", "..", "fixtures", "spike", "decisions");
const fixture = (name: string) => JSON.parse(readFileSync(join(SPIKE, name), "utf8"));
const routine = fixture("finish-checkin-routine.json");
const refusal = fixture("safety-refusal-documented.json");

const MARKER = "Quillon-7743";
const KEY = "test-key-not-real";
const request = buildDecisionsRequest(`Patient: FICTIONAL ${MARKER}: I walked the dog.`, "A short walk");

function fakeFetch(respond: () => Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function failure(promise: Promise<unknown>): Promise<DecisionsError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DecisionsError);
  return error as DecisionsError;
}

describe("fetchDecisionsClient", () => {
  it("posts the recorded shape to v1beta/decisions with the key in x-goog-api-key, with a timeout, and returns the body", async () => {
    const { impl, calls } = fakeFetch(json(200, routine.response.body));
    const body = await fetchDecisionsClient(KEY, impl).decide(request);
    expect(body).toEqual(routine.response.body);
    expect(DECISIONS_URL).toBe(routine.request.url);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/decisions");
    expect(calls[0]!.url).not.toContain(KEY);
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers).toEqual({ "content-type": "application/json", "x-goog-api-key": KEY });
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    const sent = JSON.parse(calls[0]!.init.body as string);
    expect(Object.keys(sent).sort()).toEqual(["input", "model", "questions"]);
    expect(sent.model).toBe("gemini-decision-1");
  });

  it("a documented safety refusal throws HTTP 400 with its code, and nothing of the body", async () => {
    const { impl } = fakeFetch(json(400, refusal.response.body));
    const error = await failure(fetchDecisionsClient(KEY, impl).decide(request));
    expect([error.status, error.code]).toEqual([400, "safety"]);
    expect(error.message).not.toContain("harmful");
  });

  it("an error body that echoes the input never reaches the error", async () => {
    const { impl } = fakeFetch(json(400, { error: { message: `bad input ${MARKER}`, code: `x ${MARKER}` } }));
    const error = await failure(fetchDecisionsClient(KEY, impl).decide(request));
    expect([error.status, error.code]).toEqual([400, null]);
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain(MARKER);
  });

  it("a timeout or lost connection throws with no status; a server error or unreadable body with its status", async () => {
    const lost = fakeFetch(async () => {
      throw new Error(`socket hang up ${MARKER}`);
    });
    const timeout = await failure(fetchDecisionsClient(KEY, lost.impl).decide(request));
    expect([timeout.status, timeout.code]).toEqual([null, null]);
    expect(timeout.message).not.toContain(MARKER);

    const server = await failure(fetchDecisionsClient(KEY, fakeFetch(json(503, { error: { code: "unavailable" } })).impl).decide(request));
    expect([server.status, server.code]).toEqual([503, "unavailable"]);

    const garbled = fakeFetch(async () => new Response(`not json ${MARKER}`, { status: 200 }));
    const unreadable = await failure(fetchDecisionsClient(KEY, garbled.impl).decide(request));
    expect([unreadable.status, unreadable.code]).toEqual([200, null]);
  });

  it("refuses to run without a key, so the emulator never calls Gemini", () => {
    expect(() => fetchDecisionsClient("")).toThrow("not set");
  });

  it("keeps an error code only when it is a short lower-case word", () => {
    expect(errorCodeOf({ error: { code: "prohibited_content" } })).toBe("prohibited_content");
    expect(errorCodeOf({ error: { code: 400 } })).toBeNull();
    expect(errorCodeOf({ error: { code: "Has Spaces" } })).toBeNull();
    expect(errorCodeOf(null)).toBeNull();
  });
});
