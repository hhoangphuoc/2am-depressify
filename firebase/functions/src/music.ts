// Music for a Check-in: the callable behind the Companion's suggest_music tool.
//
//   generateMusic  {patientId, mood} -> {mimeType: "audio/mpeg", audioBase64, artwork?}
//
// It asks Lyria 3.5 for about a minute of calm instrumental music and Nano Banana for optional
// matching artwork. Only the Companion's short mood description goes to the models, in fixed wording:
// no name, no Intake and no transcript. Storage is off, and nothing is written or logged. The
// Gemini key is a function secret (ADR 0002). The request and response shapes are the ones
// recorded in fixtures/spike/music/lyria-3.5.json.
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import type { CheckInStore } from "./checkInFunctions";
import { GEMINI_API_KEY } from "./gemini";
import { patientIdOf } from "./intake";
import { callerOf, requireAuth, safely, statusOf, type IntakeCall } from "./intakeFunctions";
import { ARTWORK_MODEL, MUSIC_MODEL } from "./models";
import { assertActsAsPatient } from "./patientCaller";

export const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
/** The API revision the music docs use. */
export const API_REVISION = "2026-05-20";
export const MOOD_MAX_CHARS = 200;
/** Generation took about 25 s in the recorded call. */
const MUSIC_TIMEOUT_MS = 90_000;
const ARTWORK_MAX_BASE64_CHARS = 4 * 1024 * 1024;

export interface MusicClip {
  mimeType: string;
  audioBase64: string;
  artwork?: { mimeType: string; imageBase64: string };
}

export interface MusicClient {
  /** The response body of one interaction. Throws with a `status` when the call fails. */
  createInteraction(body: unknown): Promise<unknown>;
}

export function parseMusicRequest(data: unknown): { patientId: string; mood: string } {
  const patientId = patientIdOf(data);
  const mood = (data as { mood?: unknown } | null)?.mood;
  if (typeof mood !== "string" || mood.trim() === "" || mood.length > MOOD_MAX_CHARS) {
    throw new HttpsError("invalid-argument", "A mood of at most " + MOOD_MAX_CHARS + " characters is required.");
  }
  return { patientId, mood: mood.trim() };
}

/** The interaction body: fixed calming instrumental wording around the Companion's mood line. */
export function buildMusicRequest(mood: string) {
  return {
    model: MUSIC_MODEL,
    store: false,
    input:
      "Compose about one minute of calm instrumental music for someone to listen to quietly, to ease a low mood. " +
      "Slow tempo, soft dynamics, warm and gentle, with a hopeful lift towards the end and a soft fade out. " +
      "No vocals and no lyrics. Nothing sudden, loud or tense. " +
      "The feeling to meet, in the listener's own terms: " + mood,
  };
}

export function buildArtworkRequest(mood: string) {
  return {
    model: ARTWORK_MODEL,
    store: false,
    // The image instruction leads: opening with the music brief made the model sometimes answer in text only.
    input: "Create one full-bleed square illustration that fills the entire canvas. Reply with the image only. " +
      "It accompanies a piece of calm music made from this brief; match its mood and gentle hopeful intent:\n\"" +
      buildMusicRequest(mood).input + "\"\n\n" +
      "Show one peaceful nature view: a still lakeshore in soft morning light, a sunlit meadow, or a gentle forest clearing. " +
      "Choose one scene to complement the music's mood, always feeling restful, welcoming and quietly hopeful. " +
      "A simple flat illustration with a few broad, gently curved shapes and two or three muted colors: teal, sage and warm peach with cream sky. " +
      "Let the landscape fill the whole square edge to edge as a full-bleed scene, with an open horizon and generous uncluttered space. Suggest still water, soft daylight or gentle greenery rather than intricate detail. " +
      "Do not draw a border, frame, inset panel, card, mat or margin around the scene. " +
      "No people, faces, buildings, dramatic cliffs, storms, darkness, harsh contrast, texture, patterns, text, logos, photographs or medical claims.",
    response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "1:1", image_size: "1K" },
  };
}

/** Only inline, bounded images can travel back in the callable response. */
function parseArtwork(body: unknown): MusicClip["artwork"] {
  const response = body as { status?: unknown; steps?: unknown } | null;
  if (response?.status !== undefined && response.status !== "completed") return undefined;
  if (!Array.isArray(response?.steps)) return undefined;
  for (const step of response.steps) {
    if (step?.type !== "model_output" || (step.status !== undefined && step.status !== "done") || !Array.isArray(step.content)) continue;
    for (const block of step.content) {
      if (block?.type !== "image" || !["image/jpeg", "image/png", "image/webp"].includes(block.mime_type)) continue;
      const data = block.data;
      if (typeof data !== "string" || data.length === 0 || data.length > ARTWORK_MAX_BASE64_CHARS ||
          data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) continue;
      return { mimeType: block.mime_type, imageBase64: data };
    }
  }
  return undefined;
}

/** The first audio block of the model's output, or null when there is none. */
export function parseMusic(body: unknown): MusicClip | null {
  const steps = (body as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(steps)) return null;
  for (const step of steps) {
    if (step?.type !== "model_output" || !Array.isArray(step.content)) continue;
    for (const block of step.content) {
      if (block?.type === "audio" && typeof block.data === "string" && block.data !== "" && block.mime_type === "audio/mpeg") {
        return { mimeType: block.mime_type, audioBase64: block.data };
      }
    }
  }
  return null;
}

/** The real client: one fetch, with the key in a header. Built per call so the secret is read at run time. */
export function fetchMusicClient(apiKey: string, fetchImpl: typeof fetch = fetch): MusicClient {
  // Refuse without a key, so the emulator (which has no secret) never sends a request to Gemini.
  if (!apiKey) throw new Error("The Gemini API key is not set.");
  return {
    async createInteraction(body) {
      const response = await fetchImpl(INTERACTIONS_URL, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Api-Revision": API_REVISION, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(MUSIC_TIMEOUT_MS),
      });
      // Never read the error body: it may quote the request.
      if (!response.ok) throw Object.assign(new Error("Music generation failed"), { status: response.status });
      return response.json();
    },
  };
}

export interface MusicDeps {
  store: Pick<CheckInStore, "getPatient">;
  music: MusicClient;
}

/** Makes one clip. Reads the Patient only to check the caller; writes nothing. */
export async function generateMusicHandler(call: IntakeCall, deps: MusicDeps): Promise<MusicClip> {
  const auth = requireAuth(call.auth);
  const { patientId, mood } = parseMusicRequest(call.data);
  let patient;
  try {
    patient = await deps.store.getPatient(patientId);
  } catch {
    logger.warn("generateMusic: a read failed", { patientId });
    throw new HttpsError("unavailable", "Could not reach your records. Try again.");
  }
  assertActsAsPatient(patientId, patient, auth);
  let clip: MusicClip | null;
  let artwork: MusicClip["artwork"];
  try {
    const [audio, cover] = await Promise.all([
      deps.music.createInteraction(buildMusicRequest(mood)),
      (async () => {
        try {
          return parseArtwork(await deps.music.createInteraction(buildArtworkRequest(mood)));
        } catch {
          // Artwork is optional; provider errors can contain the prompt or image.
          return undefined;
        }
      })(),
    ]);
    clip = parseMusic(audio);
    artwork = cover;
  } catch (error) {
    // Never log the error or the mood.
    logger.warn("generateMusic: the model call failed", { patientId, status: statusOf(error) });
    throw new HttpsError("unavailable", "Could not make the music. Try again.");
  }
  if (!clip) {
    // A prompt the safety filters block comes back without audio.
    logger.warn("generateMusic: no audio came back", { patientId });
    throw new HttpsError("unavailable", "Could not make the music. Try again.");
  }
  return artwork ? { ...clip, artwork } : clip;
}

/** Builds the callable. Production passes the Admin SDK and Gemini; tests pass fakes. */
export function createMusicFunctions(deps: { store: () => MusicDeps["store"]; music: () => MusicClient }) {
  const generateMusic = onCall({ secrets: [GEMINI_API_KEY], timeoutSeconds: 120, memory: "512MiB" }, (request) =>
    safely("generateMusic", () =>
      generateMusicHandler(callerOf(request), {
        store: deps.store(),
        // Built only when the model is called, after the input and caller checks.
        music: { createInteraction: (body) => deps.music().createInteraction(body) },
      }),
    ),
  );
  return { generateMusic };
}
