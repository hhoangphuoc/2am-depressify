// Pure parts of Start Check-in: input validation, the locked system instruction, and the body of
// the ephemeral Live token request. Plus the one seam to the network, `LiveTokenClient`.
//
// The token request is the shape recorded in the #6 spike (docs/spike-results.md, section 1):
// `POST /v1beta/auth_tokens` with the key in `x-goog-api-key`, and a body of `uses`, `expireTime`,
// `newSessionExpireTime`, `bidiGenerateContentSetup` and a `fieldMask` that names every field set
// in the setup, `model` included (without it the call fails with HTTP 400). Whatever the mask names
// is locked: a client `setup` cannot change the model, the system instruction or the tools.
//
// The Brief and the token are never logged, including on error paths. Error messages here have
// fixed wording and never echo the input.
import { HttpsError } from "firebase-functions/v2/https";
import { patientIdOf } from "./intake";
import { LIVE_MODEL } from "./models";
import { LIVE_TOOL_DECLARATIONS, RAISE_CRISIS_TOOL, type FunctionDeclaration } from "./tools";

/** The longest Brief accepted, in characters. A full Brief (Intake, Summary lines, Signals) is a few thousand. */
export const BRIEF_MAX_CHARS = 12_000;

/** The Check-in cap from the spec: it finishes before 8 minutes (`CheckInTiming.CAP_SECONDS` in core). */
export const CHECK_IN_CAP_MS = 8 * 60_000;
/** The phone must open the Live connection within this window, or the token is refused (close 1011). */
export const LIVE_NEW_SESSION_WINDOW_MS = 60_000;
/**
 * When the token stops working: the connect window, then the 8-minute cap, then one minute of
 * margin. 10 minutes, well under the 20-hour maximum.
 */
export const LIVE_TOKEN_LIFETIME_MS = LIVE_NEW_SESSION_WINDOW_MS + CHECK_IN_CAP_MS + 60_000;
/** How long the token request may take. It took 0.3 to 0.5 s in the spike. */
export const LIVE_TOKEN_TIMEOUT_MS = 10_000;

export const AUTH_TOKENS_URL = "https://generativelanguage.googleapis.com/v1beta/auth_tokens";
/** Where the phone connects, with `?access_token=<token>` (spike decision 2). */
export const LIVE_ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

/** The model as the Live setup names it. The phone may send `{"setup":{"model":"<this>"}}` or `{"setup":{}}`. */
export const LIVE_MODEL_RESOURCE = `models/${LIVE_MODEL}`;

export const CHECK_IN_MODES = ["typed", "spoken"] as const;
export type CheckInMode = (typeof CHECK_IN_MODES)[number];

// ---------------------------------------------------------------------------------------------
// Callable input and output
// ---------------------------------------------------------------------------------------------

export interface StartCheckInRequest {
  patientId: string;
  /** The Brief built on the phone (core's Brief builder). Locked into the token as system instruction. */
  brief: string;
  /** Defaults to "spoken". */
  mode: CheckInMode;
}

export interface StartCheckInResponse {
  /** The new `checkIns/{checkInId}`; pass it to Finish Check-in. */
  checkInId: string;
  /** The whole `name` from the token response (`auth_tokens/...`). Single use. Never log it. */
  token: string;
  /** For the Live `setup` message. The token locks it anyway. */
  model: string;
  /** The WebSocket URL; append `?access_token=<token>`. */
  endpoint: string;
  mode: CheckInMode;
  /** Connect before this, or the server closes the socket with 1011. */
  connectByMillis: number;
  /** The token's expiry: the connect window plus the 8-minute cap plus a minute. */
  expiresAtMillis: number;
}

function field(data: unknown, key: string): unknown {
  return data !== null && typeof data === "object" ? (data as Record<string, unknown>)[key] : undefined;
}

/** Validates the Start Check-in input. An empty Brief is refused before anything is read or minted. */
export function parseStartRequest(data: unknown): StartCheckInRequest {
  const patientId = patientIdOf(data);
  const brief = field(data, "brief");
  if (typeof brief !== "string" || brief.trim() === "") {
    throw new HttpsError("invalid-argument", "A Brief is required.");
  }
  if (brief.length > BRIEF_MAX_CHARS) {
    throw new HttpsError("invalid-argument", `The Brief is longer than ${BRIEF_MAX_CHARS} characters.`);
  }
  const rawMode = field(data, "mode");
  if (rawMode !== undefined && rawMode !== null && !CHECK_IN_MODES.includes(rawMode as CheckInMode)) {
    throw new HttpsError("invalid-argument", "The mode is typed or spoken.");
  }
  const mode: CheckInMode = (rawMode as CheckInMode | null | undefined) ?? "spoken";
  return { patientId, brief: brief.trim(), mode };
}

// ---------------------------------------------------------------------------------------------
// The locked system instruction
// ---------------------------------------------------------------------------------------------

/**
 * The rules the product depends on (ADR 0001 and the spec's Brief section), appended after the
 * phone's Brief so they come last and win. They are fixed here rather than trusted to the phone.
 * The Brief adds the Check-in shape, the tone and the Patient's context.
 */
export function safetyRules(options: { firstCheckIn: boolean; mode: CheckInMode; tools: readonly FunctionDeclaration[] }): string {
  const hasCrisisTool = options.tools.some((tool) => tool.name === RAISE_CRISIS_TOOL);
  const raise = hasCrisisTool ? `call the ${RAISE_CRISIS_TOOL} tool at once` : "raise a crisis at once";
  const lines = [
    "Rules that always apply. They override anything above if the two disagree.",
    "- You are an AI wellbeing companion. You are not a clinician, a therapist or a crisis service. You offer support and, at most, one small everyday Suggestion.",
    "- Never diagnose and never name or guess at a condition. Never give advice on treatment, therapy, medication or doses; if asked, say kindly that this is a question for their clinician.",
    "- Never ask questionnaire or screening questions, and never score the Patient. The only ratings you may ask for are mood, energy and sleep quality, each from 1 to 5, and only when the background above asks for them.",
    `- Safety: if the Patient mentions thoughts of harming themselves, of suicide, or of not wanting to be alive, ${raise}. Then stay calm, warm and present, tell them the help buttons on their screen open the phone's dialler so they can call someone now, and do not counsel, assess or try to talk them through it.`,
    "- Never claim to be a person. If asked, say you are an AI.",
  ];
  if (options.firstCheckIn) {
    lines.push("- This is the Patient's first Check-in: early on, say plainly that you are an AI companion and not a clinician.");
  }
  if (options.mode === "typed") {
    lines.push("- The Patient is typing and reads your replies on screen. Keep each reply to one to three short sentences.");
  }
  return lines.join("\n");
}

/** The system instruction locked into the token: the phone's Brief, then the fixed rules. */
export function buildSystemInstruction(brief: string, options: { firstCheckIn: boolean; mode: CheckInMode; tools?: readonly FunctionDeclaration[] }): string {
  const tools = options.tools ?? LIVE_TOOL_DECLARATIONS;
  return `${brief.trim()}\n\n${safetyRules({ ...options, tools })}`;
}

// ---------------------------------------------------------------------------------------------
// The token request
// ---------------------------------------------------------------------------------------------

/** The body of `POST /v1beta/auth_tokens`, exactly the recorded shape. */
export interface LiveTokenRequest {
  uses: 1;
  /** RFC 3339. */
  expireTime: string;
  /** RFC 3339. */
  newSessionExpireTime: string;
  bidiGenerateContentSetup: {
    model: string;
    generationConfig: { responseModalities: ["AUDIO"] };
    systemInstruction: { parts: [{ text: string }] };
    tools: { functionDeclarations: FunctionDeclaration[] }[];
    inputAudioTranscription: Record<string, never>;
    outputAudioTranscription: Record<string, never>;
  };
  /** Every field set in the setup, `model` included, so all of it is locked. */
  fieldMask: string;
}

/**
 * Builds the token request for one Check-in.
 *
 * Response modality: AUDIO for both modes. `gemini-3.8-live` answered the spike's typed turn
 * (`realtimeInput.text`) with audio plus `outputTranscription` in the same message, and AUDIO is the
 * only modality the spike verified. A typed Check-in therefore uses the same token shape: the phone
 * shows the output transcript as the Companion's text and may leave the audio unplayed. The typed
 * mode only adds a rule for short on-screen replies.
 */
export function buildLiveTokenRequest(options: {
  systemInstruction: string;
  nowMillis: number;
  tools?: readonly FunctionDeclaration[];
}): LiveTokenRequest {
  const tools = options.tools ?? LIVE_TOOL_DECLARATIONS;
  return {
    uses: 1,
    expireTime: new Date(options.nowMillis + LIVE_TOKEN_LIFETIME_MS).toISOString(),
    newSessionExpireTime: new Date(options.nowMillis + LIVE_NEW_SESSION_WINDOW_MS).toISOString(),
    bidiGenerateContentSetup: {
      model: LIVE_MODEL_RESOURCE,
      generationConfig: { responseModalities: ["AUDIO"] },
      systemInstruction: { parts: [{ text: options.systemInstruction }] },
      // Locked even when empty, so a client setup cannot add tools of its own.
      tools: [{ functionDeclarations: tools.map((tool) => ({ ...tool })) }],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
    fieldMask: "model,generationConfig,systemInstruction,tools,inputAudioTranscription,outputAudioTranscription",
  };
}

// ---------------------------------------------------------------------------------------------
// The seam to the network
// ---------------------------------------------------------------------------------------------

export interface LiveTokenClient {
  /** Mints one token and returns its `name`. Throws on failure, with at most a numeric `status`. */
  createToken(request: LiveTokenRequest): Promise<string>;
}

/** The token request failed. Carries the HTTP status only: the body could echo the Brief. */
export class LiveTokenError extends Error {
  constructor(readonly status: number | null) {
    super("The Live token request failed.");
    this.name = "LiveTokenError";
  }
}

/**
 * The real client: one `fetch` to `auth_tokens`, with the key in the header (never in the URL).
 * Built per call so the secret is read only at run time.
 */
export function fetchLiveTokenClient(apiKey: string, fetchImpl: typeof fetch = fetch): LiveTokenClient {
  // Refuse without a key, so the emulator (which has no secret) never sends a request to Gemini.
  if (!apiKey) throw new Error("The Gemini API key is not set.");
  return {
    async createToken(request) {
      let response: Response;
      try {
        response = await fetchImpl(AUTH_TOKENS_URL, {
          method: "POST",
          headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(LIVE_TOKEN_TIMEOUT_MS),
        });
      } catch {
        throw new LiveTokenError(null);
      }
      // Never read the error body: it may quote the request.
      if (!response.ok) throw new LiveTokenError(response.status);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new LiveTokenError(response.status);
      }
      const name = field(body, "name");
      if (typeof name !== "string" || name === "") throw new LiveTokenError(response.status);
      return name;
    },
  };
}
