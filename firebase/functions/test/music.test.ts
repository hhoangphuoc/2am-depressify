// Music: the request builder and parser against the recorded Lyria call, and the handler's caller rules.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { API_REVISION, buildArtworkRequest, buildMusicRequest, FALLBACK_MOOD, fetchMusicClient, generateMusicCoverHandler, generateMusicHandler, INTERACTIONS_URL, parseMusic, type MusicClient } from "../src/music";
import { FakeCheckInStore, PATIENT_ID, verifiedToken } from "./fakes";

const recorded = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "fixtures", "spike", "music", "lyria-3.5.json"), "utf8"));
const DATA = { patientId: PATIENT_ID, mood: " tired and a bit tense after a long week " };
const imageBlock = { type: "image", mime_type: "image/jpeg", data: "/9j/2Q==" };
const imageResponse = (block: unknown = imageBlock) => ({ status: "completed", steps: [{ type: "model_output", content: [block] }] });

/** Returns each `body` in turn (the last one repeats), throwing those that are Errors, and records what was sent. */
function music(...bodies: unknown[]) {
  if (bodies.length === 0) bodies = [recorded.response.body];
  const sent: unknown[] = [];
  const client: MusicClient = {
    async createInteraction(request) {
      sent.push(request);
      const body = bodies[Math.min(sent.length, bodies.length) - 1];
      if (body instanceof Error) throw body;
      return body;
    },
  };
  return { client, sent };
}
const refused = () => Object.assign(new Error("refused"), { status: 400, code: "prohibited_content" });
const call = (data: unknown, uid: string | null = PATIENT_ID, fake = music()) =>
  generateMusicHandler({ data, auth: uid ? { uid, token: verifiedToken(`${uid}@example.com`) } : undefined }, { store: new FakeCheckInStore(), music: fake.client });
const coverCall = (data: unknown, uid: string | null = PATIENT_ID, fake = music(imageResponse())) =>
  generateMusicCoverHandler({ data, auth: uid ? { uid, token: verifiedToken(`${uid}@example.com`) } : undefined }, { store: new FakeCheckInStore(), music: fake.client });

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

  it("serves the Patient with the trimmed mood, without making a cover", async () => {
    const fake = music();
    expect(await call(DATA, PATIENT_ID, fake)).toEqual(parseMusic(recorded.response.body));
    expect(fake.sent).toEqual([buildMusicRequest(DATA.mood.trim())]);
  });

  it("makes the cover on its own call, from the same musical brief", async () => {
    const fake = music(imageResponse());
    expect(await coverCall(DATA, PATIENT_ID, fake)).toEqual({ artwork: { mimeType: "image/jpeg", imageBase64: imageBlock.data } });
    expect(fake.sent).toEqual([buildArtworkRequest(DATA.mood.trim())]);
  });

  it.each(["tired and tense", "quietly hopeful"])("shares the exact musical brief with the cover for %s", (mood) => {
    const body = buildArtworkRequest(mood);
    expect(body).toMatchObject({
      model: "gemini-3.1-flash-lite-image", store: false,
      response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "1:1", image_size: "1K" },
    });
    expect(body.input.startsWith("Create one full-bleed square illustration")).toBe(true);
    expect(body.input).toContain(buildMusicRequest(mood).input);
    for (const instruction of ["one peaceful nature view", "complement the music's mood", "two or three muted colors", "edge to edge as a full-bleed scene", "Do not draw a border, frame", "open horizon", "No people, faces", "text, logos, photographs or medical claims"]) {
      expect(body.input).toContain(instruction);
    }
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
  ])("answers without a cover for %s", async (_name, artwork) => {
    expect(await coverCall(DATA, PATIENT_ID, music(artwork))).toEqual({});
  });

  it.each(["image/jpeg", "image/png", "image/webp"])("accepts %s artwork", async (mimeType) => {
    const result = await coverCall(DATA, PATIENT_ID, music(imageResponse({ ...imageBlock, mime_type: mimeType })));
    expect(result.artwork).toEqual({ mimeType, imageBase64: imageBlock.data });
  });

  it("accepts artwork at the encoded size limit", async () => {
    const data = "A".repeat(4 * 1024 * 1024);
    const result = await coverCall(DATA, PATIENT_ID, music(imageResponse({ ...imageBlock, data })));
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

  it.each([["music", call], ["cover", coverCall]] as const)("rejects signed-out callers, other users and bad input before asking for %s", async (_name, run) => {
    const fake = music();
    await expect(run(DATA, null, fake)).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(run(DATA, "someone-else", fake)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(run({ ...DATA, mood: "" }, PATIENT_ID, fake)).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(run({ ...DATA, mood: "x".repeat(201) }, PATIENT_ID, fake)).rejects.toMatchObject({ code: "invalid-argument" });
    expect(fake.sent).toEqual([]);
  });

  it("turns a failed call or a reply without audio into a named error without the mood", async () => {
    const message = "Could not make the music. Try again.";
    await expect(call(DATA, PATIENT_ID, music(Object.assign(new Error("failed for tired"), { status: 429 })))).rejects.toMatchObject({ code: "unavailable", message });
    await expect(call(DATA, PATIENT_ID, music({ steps: [] }))).rejects.toMatchObject({ code: "unavailable", message });
  });

  it("retries a refused mood once with the fixed fallback mood", async () => {
    const fake = music(refused(), recorded.response.body);
    expect(await call(DATA, PATIENT_ID, fake)).toEqual(parseMusic(recorded.response.body));
    expect(fake.sent).toEqual([buildMusicRequest(DATA.mood.trim()), buildMusicRequest(FALLBACK_MOOD)]);
  });

  it("gives up after the fallback, and never retries an outage or quota error", async () => {
    const twice = music(refused());
    await expect(call(DATA, PATIENT_ID, twice)).rejects.toMatchObject({ code: "unavailable" });
    expect(twice.sent).toHaveLength(2);
    const quota = music(Object.assign(new Error("quota"), { status: 429 }));
    await expect(call(DATA, PATIENT_ID, quota)).rejects.toMatchObject({ code: "unavailable" });
    expect(quota.sent).toHaveLength(1);
  });

  it("keeps only the provider's error code from a failed reply, never its message", async () => {
    const reply = (body: string) => fetchMusicClient("test-only-key", async () => new Response(body, { status: 400 }));
    const error = { message: "Input blocked: the prompt quoted here", code: "prohibited_content" };
    await expect(reply(JSON.stringify({ error })).createInteraction({})).rejects.toEqual(
      Object.assign(new Error("Music generation failed"), { status: 400, code: "prohibited_content" }));
    await expect(reply(JSON.stringify({ error: { code: "has the prompt in it" } })).createInteraction({})).rejects.toMatchObject({ status: 400, code: null });
    await expect(reply("not json").createInteraction({})).rejects.toMatchObject({ status: 400, code: null });
  });
});
