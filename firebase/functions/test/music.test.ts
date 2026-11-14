// Music: the request builder and parser against the recorded Lyria call, and the handler's caller rules.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { API_REVISION, buildArtworkRequest, buildMusicRequest, fetchMusicClient, generateMusicHandler, INTERACTIONS_URL, parseMusic, type MusicClient } from "../src/music";
import { FakeCheckInStore, PATIENT_ID } from "./fakes";

const recorded = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "fixtures", "spike", "music", "lyria-3.5.json"), "utf8"));
const DATA = { patientId: PATIENT_ID, mood: " tired and a bit tense after a long week " };
const imageBlock = { type: "image", mime_type: "image/jpeg", data: "/9j/2Q==" };
const imageResponse = (block: unknown = imageBlock) => ({ status: "completed", steps: [{ type: "model_output", content: [block] }] });

/** Returns `body`, or throws it when it is an Error, and records what was sent. */
function music(body: unknown = recorded.response.body, artwork: unknown = imageResponse()) {
  const sent: unknown[] = [];
  const client: MusicClient = {
    async createInteraction(request) {
      sent.push(request);
      const response = sent.length === 1 ? body : artwork;
      if (response instanceof Error) throw response;
      return response;
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
    expect(await call(DATA, PATIENT_ID, fake)).toEqual({
      ...parseMusic(recorded.response.body),
      artwork: { mimeType: "image/jpeg", imageBase64: imageBlock.data },
    });
    expect(fake.sent).toEqual([
      buildMusicRequest(DATA.mood.trim()),
      buildArtworkRequest(DATA.mood.trim()),
    ]);
  });

  it.each(["tired and tense", "quietly hopeful"])("shares the exact musical brief with the cover for %s", (mood) => {
    const body = buildArtworkRequest(mood);
    expect(body).toMatchObject({
      model: "gemini-3.1-flash-lite-image", store: false,
      response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "1:1", image_size: "1K" },
    });
    expect(body.input.startsWith(buildMusicRequest(mood).input + "\n\n")).toBe(true);
    for (const instruction of ["one peaceful nature view", "complement the music's mood", "two or three muted colors", "landscape fill the square", "open horizon", "No people, faces", "text, logos, photographs or medical claims"]) {
      expect(body.input).toContain(instruction);
    }
  });

  it("starts both requests before waiting for audio", async () => {
    let finishAudio!: (body: unknown) => void;
    let coverStarted = false;
    const audio = new Promise((resolve) => { finishAudio = resolve; });
    const result = generateMusicHandler({ data: DATA, auth: { uid: PATIENT_ID, token: {} } }, {
      store: new FakeCheckInStore(),
      music: { createInteraction: (body) => {
        if ((body as { model: string }).model === "lyria-3.5") return audio;
        coverStarted = true;
        finishAudio(recorded.response.body);
        return Promise.resolve(imageResponse());
      } },
    });
    await expect(result).resolves.toHaveProperty("artwork");
    expect(coverStarted).toBe(true);
  });

  it.each([
    ["provider failure", new Error("private provider error")],
    ["blocked response", { status: "failed", steps: imageResponse().steps }],
    ["safety refusal", { steps: [{ type: "model_output", content: [{ type: "text", text: "blocked" }] }] }],
    ["blocked step", { steps: [{ type: "model_output", status: "blocked", content: [imageBlock] }] }],
    ["missing response", null],
    ["malformed steps", { steps: {} }],
    ["malformed content", { steps: [null, { type: "model_output", content: {} }] }],
    ["missing image", imageResponse(null)],
    ["non-image MIME", imageResponse({ ...imageBlock, mime_type: "text/html" })],
    ["SVG", imageResponse({ ...imageBlock, mime_type: "image/svg+xml" })],
    ["empty data", imageResponse({ ...imageBlock, data: "" })],
    ["non-string data", imageResponse({ ...imageBlock, data: 123 })],
    ["invalid base64", imageResponse({ ...imageBlock, data: "!!!!" })],
    ["truncated base64", imageResponse({ ...imageBlock, data: "AAA" })],
    ["image URL", imageResponse({ ...imageBlock, data: undefined, uri: "https://example.com/cover.jpg" })],
    ["oversized image", imageResponse({ ...imageBlock, data: "A".repeat(4 * 1024 * 1024 + 4) })],
  ])("serves audio without artwork for %s", async (_name, artwork) => {
    expect(await call(DATA, PATIENT_ID, music(recorded.response.body, artwork))).toEqual(parseMusic(recorded.response.body));
  });

  it.each(["image/jpeg", "image/png", "image/webp"])("accepts %s artwork", async (mimeType) => {
    const result = await call(DATA, PATIENT_ID, music(recorded.response.body, imageResponse({ ...imageBlock, mime_type: mimeType })));
    expect(result.artwork).toEqual({ mimeType, imageBase64: imageBlock.data });
  });

  it("accepts artwork at the encoded size limit", async () => {
    const data = "A".repeat(4 * 1024 * 1024);
    const result = await call(DATA, PATIENT_ID, music(recorded.response.body, imageResponse({ ...imageBlock, data })));
    expect(result.artwork?.imageBase64.length).toBe(data.length);
  });

  it("uses the existing fetch transport and API revision for artwork", async () => {
    const body = buildArtworkRequest("tired");
    const client = fetchMusicClient("test-only-key", async (url, options) => {
      expect(url).toBe(INTERACTIONS_URL);
      expect(options).toMatchObject({
        method: "POST", body: JSON.stringify(body),
        headers: { "x-goog-api-key": "test-only-key", "Api-Revision": API_REVISION, "content-type": "application/json" },
      });
      expect(API_REVISION).toBe("2026-05-20");
      return new Response(JSON.stringify(imageResponse()));
    });
    expect(await client.createInteraction(body)).toEqual(imageResponse());
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
    await expect(call(DATA, PATIENT_ID, music(new Error("audio failed"), new Error("artwork failed")))).rejects.toMatchObject({ code: "unavailable", message });
    await expect(call(DATA, PATIENT_ID, music({ steps: [] }))).rejects.toMatchObject({ code: "unavailable", message });
  });
});
