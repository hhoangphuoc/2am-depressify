// Start Check-in: `startCheckIn {patientId} -> {token, model, expiresAtMillis}`.
//
// Called by the Patient app. Mints a single-use Gemini Live token locked to the model, the
// Companion's instruction and its tools (src/checkIn.ts). The Gemini key stays here; the phone
// gets only the token (ADR 0002).
//
// Who may call: the Patient themselves (the caller's uid is the Patient id), or any signed-in
// user for a Demo Patient (`synthetic`), as in the security rules' demo shortcut.
//
// Nothing logs the instruction (it holds the Intake highlights) or the token.
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { buildTokenRequest, parseStartRequest, TOKEN_LIFETIME_MS, type StartCheckInResponse, type TokenRequest } from "./checkIn";
import { GEMINI_API_KEY } from "./gemini";
import { callerOf, requireAuth, safely, statusOf, type IntakeCall, type PatientStore } from "./intakeFunctions";

export interface LiveTokenClient {
  /** Mints a single-use token for the request. Throws when the call fails. */
  mintToken(request: TokenRequest): Promise<string>;
}

export interface CheckInDeps {
  patients: Pick<PatientStore, "get">;
  tokens: LiveTokenClient;
}

export async function startCheckInHandler(call: IntakeCall, deps: CheckInDeps, nowMillis: number): Promise<StartCheckInResponse> {
  const auth = requireAuth(call.auth);
  const { patientId } = parseStartRequest(call.data);
  let patient;
  try {
    patient = await deps.patients.get(patientId);
  } catch {
    logger.warn("startCheckIn: could not read the Patient record", { patientId });
    throw new HttpsError("unavailable", "Could not reach the Patient record. Try again.");
  }
  // One message for a missing Patient and someone else's, so ids cannot be probed.
  if (!patient || (auth.uid !== patientId && patient.synthetic !== true)) {
    throw new HttpsError("permission-denied", "Only this Patient can start their Check-in.");
  }
  const request = buildTokenRequest({ intakeHighlights: patient.intakeHighlights ?? "" }, nowMillis);
  let token: string;
  try {
    token = await deps.tokens.mintToken(request);
  } catch (error) {
    // Never log the error itself: its body may echo the instruction.
    logger.warn("startCheckIn: minting the Live token failed", { patientId, status: statusOf(error) });
    throw new HttpsError("unavailable", "Could not start the Check-in. Try again.");
  }
  return { token, model: request.model, expiresAtMillis: nowMillis + TOKEN_LIFETIME_MS };
}

export function createCheckInFunctions(deps: { patients: () => Pick<PatientStore, "get">; tokens: () => LiveTokenClient }) {
  const startCheckIn = onCall({ secrets: [GEMINI_API_KEY], timeoutSeconds: 30 }, (request) =>
    safely("startCheckIn", () =>
      startCheckInHandler(
        callerOf(request),
        // Built only when the token is minted, after the caller checks.
        { patients: deps.patients(), tokens: { mintToken: (tokenRequest) => deps.tokens().mintToken(tokenRequest) } },
        Date.now(),
      ),
    ),
  );
  return { startCheckIn };
}
