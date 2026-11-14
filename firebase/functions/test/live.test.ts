// Start Check-in's pure parts: input validation, the locked system instruction, the token request
// body against the shape recorded in the #6 spike, and the fetch client.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTH_TOKENS_URL,
  BRIEF_MAX_CHARS,
  CHECK_IN_CAP_MS,
  LIVE_NEW_SESSION_WINDOW_MS,
  LIVE_TOKEN_LIFETIME_MS,
  buildLiveTokenRequest,
  buildSystemInstruction,
  fetchLiveTokenClient,
  parseStartRequest,
  safetyRules,
} from "../src/live";
import { LIVE_MODEL } from "../src/models";
import { LIVE_TOOL_DECLARATIONS, RAISE_CRISIS_TOOL, type FunctionDeclaration } from "../src/tools";

const SPIKE = join(__dirname, "..", "..", "..", "fixtures", "spike", "live");
const recorded = JSON.parse(readFileSync(join(SPIKE, "token-bidiGenerateContentSetup.json"), "utf8"));
const recordedBody = recorded.request.body;

const NOW = Date.UTC(2026, 10, 14, 11, 28, 28, 747);
const BRIEF = "You are talking with Alex. Fictional Brief: greet them, ask how the walk went, then ratings.";

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("parseStartRequest", () => {
  it("accepts a Patient id and a Brief, and defaults to a spoken Check-in", () => {
    expect(parseStartRequest({ patientId: "p1", brief: `  ${BRIEF}\n` })).toEqual({ patientId: "p1", brief: BRIEF, mode: "spoken" });
    expect(parseStartRequest({ patientId: "p1", brief: BRIEF, mode: "typed" }).mode).toBe("typed");
    expect(parseStartRequest({ patientId: "p1", brief: BRIEF, mode: null }).mode).toBe("spoken");
  });

  it("refuses an empty, missing or whitespace Brief", () => {
    expect(codeOf(() => parseStartRequest({ patientId: "p1", brief: "" }))).toBe("invalid-argument");
    expect(codeOf(() => parseStartRequest({ patientId: "p1", brief: " \n\t " }))).toBe("invalid-argument");
    expect(codeOf(() => parseStartRequest({ patientId: "p1" }))).toBe("invalid-argument");
    expect(codeOf(() => parseStartRequest({ patientId: "p1", brief: 42 }))).toBe("invalid-argument");
  });

  it("caps the Brief's size", () => {
    expect(parseStartRequest({ patientId: "p1", brief: "x".repeat(BRIEF_MAX_CHARS) }).brief).toHaveLength(BRIEF_MAX_CHARS);
    expect(codeOf(() => parseStartRequest({ patientId: "p1", brief: "x".repeat(BRIEF_MAX_CHARS + 1) }))).toBe("invalid-argument");
  });

  it("refuses an unknown mode and a bad Patient id", () => {
    expect(codeOf(() => parseStartRequest({ patientId: "p1", brief: BRIEF, mode: "video" }))).toBe("invalid-argument");
    expect(codeOf(() => parseStartRequest({ patientId: "", brief: BRIEF }))).toBe("invalid-argument");
    expect(codeOf(() => parseStartRequest({ patientId: "a/b", brief: BRIEF }))).toBe("invalid-argument");
    expect(codeOf(() => parseStartRequest(null))).toBe("invalid-argument");
  });

  it("never echoes the Brief in an error", () => {
    try {
      parseStartRequest({ patientId: "p1", brief: `${BRIEF}${"y".repeat(BRIEF_MAX_CHARS)}` });
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("Alex");
    }
  });
});

describe("the locked system instruction", () => {
  const rules = (firstCheckIn: boolean, mode: "typed" | "spoken" = "spoken", tools: FunctionDeclaration[] = []) =>
    buildSystemInstruction(BRIEF, { firstCheckIn, mode, tools });

  it("is the Brief followed by the fixed rules, which come last", () => {
    const text = rules(false);
    expect(text.startsWith(BRIEF)).toBe(true);
    expect(text.indexOf("Rules that always apply")).toBeGreaterThan(text.indexOf(BRIEF));
  });

  it("carries the not-a-clinician boundary: no diagnosis, no treatment or medication advice, no questionnaires", () => {
    const text = rules(false).toLowerCase();
    expect(text).toContain("not a clinician");
    expect(text).toContain("never diagnose");
    expect(text).toMatch(/never give advice on treatment, therapy, medication/);
    expect(text).toContain("never ask questionnaire");
  });

  it("carries the crisis instruction: raise a crisis at once, stay present, point to the call buttons, do not counsel", () => {
    const text = rules(false).toLowerCase();
    expect(text).toMatch(/harming themselves|suicide/);
    expect(text).toContain("raise a crisis at once");
    expect(text).toContain("help buttons on their screen");
    expect(text).toContain("do not counsel");
  });

  it("names the crisis tool only once the catalog declares it (#17)", () => {
    expect(rules(false)).not.toContain(RAISE_CRISIS_TOOL);
    const crisisTool: FunctionDeclaration = { name: RAISE_CRISIS_TOOL, description: "Raise a crisis.", parameters: { type: "OBJECT", properties: {} } };
    expect(rules(false, "spoken", [crisisTool])).toContain(`call the ${RAISE_CRISIS_TOOL} tool at once`);
  });

  it("says it is an AI at the first Check-in only", () => {
    expect(rules(true)).toContain("first Check-in");
    expect(rules(true).toLowerCase()).toContain("say plainly that you are an ai");
    expect(rules(false)).not.toContain("first Check-in");
  });

  it("asks for short on-screen replies in a typed Check-in", () => {
    expect(rules(false, "typed")).toContain("The Patient is typing");
    expect(rules(false, "spoken")).not.toContain("The Patient is typing");
  });

  it("uses the words of the framing (ADR 0001)", () => {
    const text = safetyRules({ firstCheckIn: true, mode: "typed", tools: [] }).toLowerCase();
    expect(text).not.toMatch(/risk score|you are a therapist|treatment plan/);
  });
});

describe("the token request body", () => {
  const body = buildLiveTokenRequest({ systemInstruction: "LOCKED INSTRUCTION", nowMillis: NOW });

  it("has the recorded shape: the same top-level fields and setup fields as the spike's working request", () => {
    expect(Object.keys(body).sort()).toEqual(Object.keys(recordedBody).sort());
    expect(Object.keys(body.bidiGenerateContentSetup).sort()).toEqual(Object.keys(recordedBody.bidiGenerateContentSetup).sort());
    expect(body.fieldMask).toBe(recordedBody.fieldMask);
  });

  it("is single use and locked to the Live model", () => {
    expect(body.uses).toBe(1);
    expect(body.bidiGenerateContentSetup.model).toBe(`models/${LIVE_MODEL}`);
    expect(body.bidiGenerateContentSetup.model).toBe("models/gemini-3.8-live");
  });

  it("locks every field it sets, model included", () => {
    const mask = body.fieldMask.split(",");
    expect(mask).toContain("model");
    for (const key of Object.keys(body.bidiGenerateContentSetup)) expect(mask).toContain(key);
  });

  it("locks the system instruction, audio output, both transcriptions and the tool declarations", () => {
    const setup = body.bidiGenerateContentSetup;
    expect(setup.systemInstruction).toEqual({ parts: [{ text: "LOCKED INSTRUCTION" }] });
    expect(setup.generationConfig).toEqual(recordedBody.bidiGenerateContentSetup.generationConfig);
    expect(setup.inputAudioTranscription).toEqual({});
    expect(setup.outputAudioTranscription).toEqual({});
    expect(setup.tools).toEqual([{ functionDeclarations: [...LIVE_TOOL_DECLARATIONS] }]);
  });

  it("carries the tools it is given in the recorded declaration shape", () => {
    const tool = recordedBody.bidiGenerateContentSetup.tools[0].functionDeclarations[0] as FunctionDeclaration;
    const withTool = buildLiveTokenRequest({ systemInstruction: "x", nowMillis: NOW, tools: [tool] });
    expect(withTool.bidiGenerateContentSetup.tools).toEqual(recordedBody.bidiGenerateContentSetup.tools);
  });

  it("opens a 60-second connect window and expires within the Check-in cap plus margin, far under 20 hours", () => {
    expect(Date.parse(body.newSessionExpireTime) - NOW).toBe(LIVE_NEW_SESSION_WINDOW_MS);
    expect(LIVE_NEW_SESSION_WINDOW_MS).toBe(60_000);
    const lifetime = Date.parse(body.expireTime) - NOW;
    expect(lifetime).toBe(LIVE_TOKEN_LIFETIME_MS);
    expect(lifetime).toBeGreaterThan(LIVE_NEW_SESSION_WINDOW_MS + CHECK_IN_CAP_MS);
    expect(lifetime).toBeLessThanOrEqual(10 * 60_000);
    expect(body.expireTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("fetchLiveTokenClient", () => {
  const request = buildLiveTokenRequest({ systemInstruction: `${BRIEF} SECRET-BRIEF-MARKER`, nowMillis: NOW });

  function stubFetch(status: number, body: unknown) {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    return { impl, calls };
  }

  it("posts the body to v1beta/auth_tokens with the key in the header, never in the URL, and returns the whole name", async () => {
    const { impl, calls } = stubFetch(200, { name: "auth_tokens/abc123" });
    const token = await fetchLiveTokenClient("KEY-123", impl).createToken(request);
    expect(token).toBe("auth_tokens/abc123");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(AUTH_TOKENS_URL);
    expect(calls[0]!.url).not.toContain("KEY-123");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("KEY-123");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(request);
  });

  it("fails with the status only, never the error body or the Brief", async () => {
    const { impl } = stubFetch(400, { error: { message: `bad request near SECRET-BRIEF-MARKER` } });
    const error = await fetchLiveTokenClient("KEY-123", impl).createToken(request).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 400 });
    expect(JSON.stringify(error)).not.toContain("SECRET-BRIEF-MARKER");
    expect(String((error as Error).message)).not.toContain("SECRET-BRIEF-MARKER");
  });

  it("fails on a reply without a name, and on a network error", async () => {
    await expect(fetchLiveTokenClient("k", stubFetch(200, {}).impl).createToken(request)).rejects.toMatchObject({ status: 200 });
    const broken = (async () => {
      throw new Error("socket hang up SECRET-BRIEF-MARKER");
    }) as typeof fetch;
    const error = await fetchLiveTokenClient("k", broken).createToken(request).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: null });
    expect(String((error as Error).message)).not.toContain("SECRET-BRIEF-MARKER");
  });

  it("refuses to build without a key", () => {
    expect(() => fetchLiveTokenClient("")).toThrow();
  });
});
