// Music: the request builder and parser against the recorded Lyria call, and the handler's caller rules.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildMusicRequest, generateMusicHandler, parseMusic, type MusicClient } from "../src/music";
import { FakeCheckInStore, PATIENT_ID } from "./fakes";

const recorded = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "fixtures", "spike", "music", "lyria-3.5.json"), "utf8"));
const DATA = { patientId: PATIENT_ID, mood: " tired and a bit tense after a long week " };

/** Returns `body`, or throws it when it is an Error, and records what was sent. */
function music(body: unknown = recorded.response.body) {
  const sent: unknown[] = [];
  const client: MusicClient = {
    async createInteraction(request) {
      sent.push(request);
      if (body instanceof Error) throw body;
      return body;
    },
  };
  return { client, sent };
}
const call = (data: unknown, uid: string | null = PATIENT_ID, fake = music()) =>
  generateMusicHandler({ data, auth: uid ? { uid, token: {} } : undefined }, { store: new FakeCheckInStore(), music: fake.client });

describe("generateMusic", () => {
  it("asks Lyria 3.5, storage off, for calm instrumental music around the mood only", () => {
    const body = buildMusicRequest("tired and a bit tense");
    expect(body).toMatchObject({ model: recorded.request.body.model, store: false });
    expect(body.input).toMatch(/No vocals and no lyrics/);
    expect(body.input.endsWith("tired and a bit tense")).toBe(true);
  });

  it("reads the MP3 out of the recorded response", () => {
    expect(parseMusic(recorded.response.body)).toEqual({ mimeType: "audio/mpeg", audioBase64: expect.stringMatching(/^[A-Za-z0-9+/=]{64}$/) });
    expect(parseMusic({ steps: [{ type: "model_output", content: [{ type: "text", text: "[[A0]]" }] }] })).toBeNull();
    expect(parseMusic({})).toBeNull();
  });

  it("serves the Patient with the trimmed mood", async () => {
    const fake = music();
    expect(await call(DATA, PATIENT_ID, fake)).toMatchObject({ mimeType: "audio/mpeg" });
    expect(fake.sent).toEqual([buildMusicRequest("tired and a bit tense after a long week")]);
  });

  it("rejects signed-out callers, other users and bad input before calling the model", async () => {
    const fake = music();
    await expect(call(DATA, null, fake)).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(call(DATA, "someone-else", fake)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(call({ ...DATA, mood: "" }, PATIENT_ID, fake)).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(call({ ...DATA, mood: "x".repeat(201) }, PATIENT_ID, fake)).rejects.toMatchObject({ code: "invalid-argument" });
    expect(fake.sent).toEqual([]);
  });

  it("turns a failed call or a reply without audio into a named error without the mood", async () => {
    const message = "Could not make the music. Try again.";
    await expect(call(DATA, PATIENT_ID, music(Object.assign(new Error("failed for tired"), { status: 429 })))).rejects.toMatchObject({ code: "unavailable", message });
    await expect(call(DATA, PATIENT_ID, music({ steps: [] }))).rejects.toMatchObject({ code: "unavailable", message });
  });
});
