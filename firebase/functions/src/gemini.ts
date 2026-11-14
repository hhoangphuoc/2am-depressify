// The one seam between the functions and the Gemini text model. Handlers depend on the
// `TextModelClient` interface; tests pass a fake, and only `genaiTextClient` talks to Gemini.
import { GoogleGenAI } from "@google/genai";
import { defineSecret } from "firebase-functions/params";
import type { TokenRequest } from "./checkIn";
import type { LiveTokenClient } from "./checkInFunctions";

/** The Gemini API key, a function secret. It never reaches a client. */
export const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

/** How long a text model call may take before the function gives up. */
export const TEXT_MODEL_TIMEOUT_MS = 15_000;

/**
 * One non-streaming call to the Interactions API (`POST /v1/interactions`). `store` is always
 * false: Gemini keeps no copy of the input or the output. The SDK defaults to `v1`; Live tokens and
 * Decisions exist only on `v1beta`, so those calls must set the API version when they are added
 * (docs/research/gemini-api.md).
 */
export interface TextRequest {
  model: string;
  store: false;
  system_instruction: string;
  input: string;
}

export interface TextModelClient {
  /** The model's text output, or null when it returned none. Throws when the call fails. */
  generateText(request: TextRequest): Promise<string | null>;
}

/** The real client, built per call so the secret is read only at run time. */
export function genaiTextClient(apiKey: string): TextModelClient {
  // Without a key the SDK would fall back to environment variables; refuse instead, so the
  // emulator (which has no secret) never sends a request to Gemini.
  if (!apiKey) throw new Error("The Gemini API key is not set.");
  const ai = new GoogleGenAI({ apiKey });
  return {
    async generateText(request) {
      const interaction = await ai.interactions.create(request, { timeout_ms: TEXT_MODEL_TIMEOUT_MS });
      return interaction.output_text ?? null;
    },
  };
}

/**
 * Mints single-use Live tokens (`POST /v1beta/auth_tokens`). Tokens exist only on `v1beta`, so the
 * version is set here; the constraints lock the model and the whole Live configuration.
 */
export function genaiTokenClient(apiKey: string): LiveTokenClient {
  if (!apiKey) throw new Error("The Gemini API key is not set.");
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1beta" } });
  return {
    async mintToken(request: TokenRequest) {
      const token = await ai.authTokens.create({
        config: {
          uses: 1,
          expireTime: request.expireTime,
          newSessionExpireTime: request.newSessionExpireTime,
          // The SDK's types lag the Live setup fields (tool behavior, VAD); the wire shape is the documented one.
          liveConnectConstraints: { model: request.model, config: request.config as never },
          httpOptions: { apiVersion: "v1beta", timeout: TEXT_MODEL_TIMEOUT_MS },
        },
      });
      if (!token.name) throw new Error("No token came back.");
      return token.name;
    },
  };
}
