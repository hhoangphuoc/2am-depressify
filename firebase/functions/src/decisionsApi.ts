// The one seam between the functions and the Gemini Decisions API (#20). Finish Check-in depends on
// the `DecisionsClient` interface; tests pass a fake, and only `fetchDecisionsClient` talks to Gemini.
//
// The request is the shape recorded in the #6 spike (docs/spike-results.md, section 4):
// `POST /v1beta/decisions` (`v1beta` only) with the key in `x-goog-api-key`, and a body of
// `{model, input, questions: {<key>: {type: "noul", instructions}}}`. Answers come back as
// `answers.<key>.{type, noul, confidence}`. Errors are HTTP 4xx/5xx with
// `{"error": {"message", "code"}}`, where `code` is a string (`safety`, `invalid_request`, ...).
//
// The input is a Check-in transcript. It is never logged, and neither is any error body: the error
// this client throws carries the HTTP status and the error code only, and the code is kept only when
// it is a short lower-case word, so it can never echo the input.

/** One yes/no question. `noul` answers with the probability of "yes", from 0 to 1. */
export interface DecisionQuestion {
  type: "noul";
  instructions: string;
}

export interface DecisionsRequest {
  model: string;
  /** The text the questions are about. Never logged. */
  input: string;
  questions: Record<string, DecisionQuestion>;
}

export interface DecisionsClient {
  /** The response body (unvalidated; see `parseDecisionAnswers`). Throws a `DecisionsError` when the call fails. */
  decide(request: DecisionsRequest): Promise<unknown>;
}

export const DECISIONS_URL = "https://generativelanguage.googleapis.com/v1beta/decisions";

/**
 * How long one Decisions call may take. The spike's calls took 0.3 to 1.3 s. Finish Check-in runs it
 * alongside the text model (40 s), inside the callable's 60-second limit.
 */
export const DECISIONS_TIMEOUT_MS = 15_000;

/** The call failed. `status` is null for a timeout or a lost connection; `code` is the API's error code, if it was a plain word. */
export class DecisionsError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(status === null ? "The Decisions request did not complete." : `The Decisions request failed with HTTP ${status}.`);
    this.name = "DecisionsError";
  }
}

/** The error body's `error.code` when it is a short lower-case word, otherwise null. */
export function errorCodeOf(body: unknown): string | null {
  const error = body !== null && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  const code = error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^[a-z_]{1,40}$/.test(code) ? code : null;
}

/**
 * The real client: one `fetch` to `/v1beta/decisions`, with the key in the header (never in the
 * URL), one attempt, and a timeout.
 */
export function fetchDecisionsClient(apiKey: string, fetchImpl: typeof fetch = fetch): DecisionsClient {
  // The emulator has no secret: refuse rather than send a request without a key.
  if (!apiKey) throw new Error("The Gemini API key is not set.");
  return {
    async decide(request) {
      let response: Response;
      try {
        response = await fetchImpl(DECISIONS_URL, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(DECISIONS_TIMEOUT_MS),
        });
      } catch {
        throw new DecisionsError(null, null);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new DecisionsError(response.status, null);
      }
      if (!response.ok) throw new DecisionsError(response.status, errorCodeOf(body));
      return body;
    },
  };
}
