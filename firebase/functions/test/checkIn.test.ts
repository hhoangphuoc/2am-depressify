import { describe, expect, it } from "vitest";
import { COMPANION_TOOLS, buildSystemInstruction } from "../src/checkIn";
import { startCheckInHandler, type LiveTokenClient } from "../src/checkInFunctions";
import type { TokenRequest } from "../src/checkIn";
import { FakePatientStore, PATIENT_ID, anonymousPatient, clinician, CLINICIAN_EMAIL } from "./fakes";
import { newPatientDoc } from "../src/types";

const NOW = Date.UTC(2026, 10, 14, 10, 0, 0);

class FakeTokens implements LiveTokenClient {
  readonly requests: TokenRequest[] = [];
  fail = false;
  async mintToken(request: TokenRequest) {
    this.requests.push(request);
    if (this.fail) throw Object.assign(new Error(`echo: ${JSON.stringify(request)}`), { status: 500 });
    return "auth_tokens/abc";
  }
}

function patients() {
  return new FakePatientStore({
    [PATIENT_ID]: { ...newPatientDoc("Live patient", CLINICIAN_EMAIL), intakeHighlights: "- Likes the sea" },
    "demo-steady": { ...newPatientDoc("Demo", CLINICIAN_EMAIL), synthetic: true },
  });
}

describe("startCheckIn", () => {
  it("gives the Patient a token locked to the Live model, the instruction and the tools", async () => {
    const tokens = new FakeTokens();
    const result = await startCheckInHandler({ data: { patientId: PATIENT_ID }, auth: anonymousPatient }, { patients: patients(), tokens }, NOW);

    expect(result).toEqual({ token: "auth_tokens/abc", model: "gemini-3.8-live", expiresAtMillis: NOW + 600_000 });
    const [request] = tokens.requests;
    expect(request!.model).toBe("gemini-3.8-live");
    expect(request!.config.systemInstruction.parts[0]!.text).toContain("- Likes the sea");
    expect(request!.config.tools[0]!.functionDeclarations.map((t) => t.name)).toEqual(COMPANION_TOOLS.map((t) => t.name));
    expect(request!.config.responseModalities).toEqual(["AUDIO"]);
    expect(request!.newSessionExpireTime).toBe(new Date(NOW + 60_000).toISOString());
  });

  it("refuses signed-out callers, another Patient's id and unknown ids, without minting", async () => {
    const tokens = new FakeTokens();
    const deps = { patients: patients(), tokens };
    await expect(startCheckInHandler({ data: { patientId: PATIENT_ID } }, deps, NOW)).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(startCheckInHandler({ data: { patientId: PATIENT_ID }, auth: clinician }, deps, NOW)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(startCheckInHandler({ data: { patientId: "nobody" }, auth: anonymousPatient }, deps, NOW)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(startCheckInHandler({ data: {}, auth: anonymousPatient }, deps, NOW)).rejects.toMatchObject({ code: "invalid-argument" });
    expect(tokens.requests).toHaveLength(0);
  });

  it("lets any signed-in user start a Check-in as a Demo Patient", async () => {
    const result = await startCheckInHandler({ data: { patientId: "demo-steady" }, auth: anonymousPatient }, { patients: patients(), tokens: new FakeTokens() }, NOW);
    expect(result.token).toBe("auth_tokens/abc");
  });

  it("turns a failed mint into fixed wording that carries nothing of the instruction", async () => {
    const tokens = new FakeTokens();
    tokens.fail = true;
    const error = await startCheckInHandler({ data: { patientId: PATIENT_ID }, auth: anonymousPatient }, { patients: patients(), tokens }, NOW).catch((e) => e);
    expect(error.code).toBe("unavailable");
    expect(error.message).not.toContain("sea");
  });
});

describe("the Companion's instruction and tools", () => {
  const text = buildSystemInstruction({ intakeHighlights: "" });

  it("keeps the wellbeing boundary, the AI disclosure and the crisis rule", () => {
    expect(text).toContain("not a clinician");
    expect(text).toContain("Never diagnose");
    expect(text).toContain("you are an AI");
    expect(text).toContain("call raise_crisis immediately");
    expect(text).toContain("(none yet)");
  });

  it("has no questionnaire tool and names every tool once", () => {
    const names = COMPANION_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(JSON.stringify(COMPANION_TOOLS).toLowerCase()).not.toContain("phq");
    for (const name of names) expect(text).toContain(name);
  });
});
