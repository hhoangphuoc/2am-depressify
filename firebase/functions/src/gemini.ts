// The one seam between the functions and the Gemini text model. Handlers depend on the
// `TextModelClient` interface; tests pass a fake, and only `genaiTextClient` talks to Gemini.
import { GoogleGenAI } from "@google/genai";
import { defineSecret } from "firebase-functions/params";

/** The Gemini API key, a function secret. It never reaches a client. */
export const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

/** How long a text model call may take before the function gives up. */
export const TEXT_MODEL_TIMEOUT_MS = 15_000;

/**
 * One non-streaming call to the Interactions API (`POST /v1/interactions`). `store` is always
 * false: Gemini keeps no copy of the input or the output.
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
  const ai = new GoogleGenAI({ apiKey });
  return {
    async generateText(request) {
      const interaction = await ai.interactions.create(request, { timeout_ms: TEXT_MODEL_TIMEOUT_MS });
      return interaction.output_text ?? null;
    },
  };
}
