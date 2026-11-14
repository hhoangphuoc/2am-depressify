// The Intake callables. The Clinician pastes the clinical report on the Patient page:
//
//   extractIntake  {patientId, reportText} -> {highlights, wordCount, trimmed}
//                  Calls the text model with storage off. Writes nothing.
//   saveIntake     {patientId, highlights} -> {intakeHighlights, wordCount}
//                  Writes `patients/{patientId}.intakeHighlights` and nothing else.
//
// Both are for the Patient's Clinician only (`assertClinicianOf`). The security rules do not let a
// client write `intakeHighlights`, so the save goes through here too.
//
// The report text is never stored and never logged, including on error paths: every failure is
// turned into an HttpsError with fixed wording, and the only log line names the Patient id and an
// HTTP status. test/intake-logging.test.ts checks this through the callable's HTTP layer.
import type { Firestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { assertClinicianOf, type CallerAuth } from "./clinician";
import { GEMINI_API_KEY, type TextModelClient } from "./gemini";
import {
  buildIntakeRequest,
  countWords,
  highlightsFromModel,
  parseExtractRequest,
  parseSaveRequest,
  type ExtractIntakeResponse,
  type SaveIntakeResponse,
} from "./intake";
import { COLLECTIONS, type PatientDoc } from "./types";

/** Reads a Patient record and writes its Intake highlights. */
export interface PatientStore {
  get(patientId: string): Promise<Partial<PatientDoc> | undefined>;
  /** Writes `intakeHighlights` and leaves every other field as it is. */
  setIntakeHighlights(patientId: string, highlights: string): Promise<void>;
}

export interface IntakeDeps {
  patients: PatientStore;
  textModel: TextModelClient;
}

/** The parts of a callable request the handlers read. */
export interface IntakeCall {
  data: unknown;
  auth?: CallerAuth;
}

/** The Admin SDK store used in production and in the emulator tests. */
export function adminPatientStore(db: Firestore): PatientStore {
  const ref = (patientId: string) => db.collection(COLLECTIONS.patients).doc(patientId);
  return {
    async get(patientId) {
      const snapshot = await ref(patientId).get();
      return snapshot.exists ? (snapshot.data() as Partial<PatientDoc>) : undefined;
    },
    async setIntakeHighlights(patientId, highlights) {
      await ref(patientId).update({ intakeHighlights: highlights });
    },
  };
}

export function requireAuth(auth: CallerAuth | undefined): CallerAuth {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  return auth;
}

async function requireClinician(patients: PatientStore, patientId: string, auth: CallerAuth): Promise<void> {
  let patient: Partial<PatientDoc> | undefined;
  try {
    patient = await patients.get(patientId);
  } catch {
    logger.warn("Intake: could not read the Patient record", { patientId });
    throw new HttpsError("unavailable", "Could not reach the Patient record. Try again.");
  }
  assertClinicianOf(patient, auth);
}

/** An HTTP status from a failed model call, and nothing else from the error. */
export function statusOf(error: unknown): number | null {
  const status = error !== null && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  return typeof status === "number" ? status : null;
}

/** Turns report text into highlights for the Clinician to review. Writes nothing. */
export async function extractIntakeHandler(call: IntakeCall, deps: IntakeDeps): Promise<ExtractIntakeResponse> {
  const auth = requireAuth(call.auth);
  // Empty or whitespace-only input stops here, before any read or model call.
  const { patientId, reportText } = parseExtractRequest(call.data);
  await requireClinician(deps.patients, patientId, auth);

  let output: string | null;
  try {
    output = await deps.textModel.generateText(buildIntakeRequest(reportText));
  } catch (error) {
    // Never log the error itself: its message or body may echo the request.
    logger.warn("extractIntake: the text model call failed", { patientId, status: statusOf(error) });
    throw new HttpsError("unavailable", "Could not extract highlights. Try again.");
  }

  const result = highlightsFromModel(output);
  if (result.wordCount === 0) {
    logger.warn("extractIntake: the text model returned no highlights", { patientId });
    throw new HttpsError("unavailable", "No highlights came back. Try again.");
  }
  return result;
}

/** Saves reviewed highlights on the Patient record. Writes `intakeHighlights` only. */
export async function saveIntakeHandler(call: IntakeCall, deps: Pick<IntakeDeps, "patients">): Promise<SaveIntakeResponse> {
  const auth = requireAuth(call.auth);
  const { patientId, highlights } = parseSaveRequest(call.data);
  await requireClinician(deps.patients, patientId, auth);
  try {
    await deps.patients.setIntakeHighlights(patientId, highlights);
  } catch {
    logger.warn("saveIntake: the write failed", { patientId });
    throw new HttpsError("unavailable", "Could not save the highlights. Try again.");
  }
  return { intakeHighlights: highlights, wordCount: countWords(highlights) };
}

/** Narrows the framework's auth context to what the handlers read. */
export function callerOf(request: CallableRequest<unknown>): IntakeCall {
  return { data: request.data, auth: request.auth ? { uid: request.auth.uid, token: request.auth.token } : undefined };
}

/**
 * Lets an HttpsError through and turns anything else into one with fixed wording, so the
 * framework never logs an unexpected error (whose message could echo the input).
 */
export async function safely<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error(`${name}: unexpected failure`, { status: statusOf(error) });
    throw new HttpsError("internal", "Something went wrong. Try again.");
  }
}

/** How the callables get their dependencies, built per request so secrets are read at run time. */
export interface IntakeDepsFactory {
  patients: () => PatientStore;
  textModel: () => TextModelClient;
}

/** Builds the two callables. Production passes the Admin SDK and Gemini; tests pass fakes. */
export function createIntakeFunctions(deps: IntakeDepsFactory) {
  const extractIntake = onCall({ secrets: [GEMINI_API_KEY], timeoutSeconds: 60 }, (request) =>
    safely("extractIntake", () =>
      extractIntakeHandler(callerOf(request), {
        patients: deps.patients(),
        // Built only when the model is called, after the input and caller checks.
        textModel: { generateText: (textRequest) => deps.textModel().generateText(textRequest) },
      }),
    ),
  );
  const saveIntake = onCall((request) =>
    safely("saveIntake", () => saveIntakeHandler(callerOf(request), { patients: deps.patients() })),
  );
  return { extractIntake, saveIntake };
}
