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
 * false: Gemini keeps no copy of the input or the output. The SDK defaults to `v1`; Live tokens and
 * Decisions exist only on `v1beta`, so those calls must set the API version when they are added
 * (docs/research/gemini-api.md).
 */
export interface TextRequest {
  model: string;
  store: false;
  system_instruction: string;
  input: string;
  /**
   * Structured output, the shape recorded in the #6 spike: the reply is JSON matching `schema`,
   * read from `output_text`. The schema's length limits are not enforced by the model, so callers
   * still validate and cap what comes back.
   */
  response_format?: JsonResponseFormat;
}

export interface JsonResponseFormat {
  type: "text";
  mime_type: "application/json";
  schema: Record<string, unknown>;
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
