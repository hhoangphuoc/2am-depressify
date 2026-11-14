// Music for a Check-in: the callable behind the Companion's suggest_music tool.
//
//   generateMusic  {patientId, mood} -> {mimeType: "audio/mpeg", audioBase64}
//
// It asks Lyria 3.5 for about a minute of calm instrumental music that meets the mood the
// Companion describes. Only that short description goes to the model, wrapped in fixed wording:
// no name, no Intake and no transcript. Storage is off, and nothing is written or logged. The
// Gemini key is a function secret (ADR 0002). The request and response shapes are the ones
// recorded in fixtures/spike/music/lyria-3.5.json.
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import type { CheckInStore } from "./checkInFunctions";
import { GEMINI_API_KEY } from "./gemini";
import { patientIdOf } from "./intake";
import { callerOf, requireAuth, safely, statusOf, type IntakeCall } from "./intakeFunctions";
import { MUSIC_MODEL } from "./models";
import { assertActsAsPatient } from "./patientCaller";

export const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
/** The API revision the music docs use. */
export const API_REVISION = "2026-05-20";
export const MOOD_MAX_CHARS = 200;
/** Generation took about 25 s in the recorded call. */
const MUSIC_TIMEOUT_MS = 90_000;

export interface MusicClip {
  mimeType: string;
  audioBase64: string;
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
  try {
    clip = parseMusic(await deps.music.createInteraction(buildMusicRequest(mood)));
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
  return clip;
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
