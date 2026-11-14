// Fakes for the Intake handlers: an in-memory Patient store and a scripted text model.
import type { TextModelClient, TextRequest } from "../src/gemini";
import type { CallerAuth } from "../src/clinician";
import type { PatientStore } from "../src/intakeFunctions";
import { newPatientDoc, type PatientDoc } from "../src/types";

export const CLINICIAN_EMAIL = "clinician@example.com";
export const OTHER_CLINICIAN_EMAIL = "other-clinician@example.com";
export const PATIENT_ID = "patient-1";

export const clinician: CallerAuth = { uid: "clinician-uid", token: { email: CLINICIAN_EMAIL } };
export const otherClinician: CallerAuth = { uid: "other-uid", token: { email: OTHER_CLINICIAN_EMAIL } };
/** An anonymous Patient: signed in, no email. */
export const anonymousPatient: CallerAuth = { uid: PATIENT_ID, token: {} };

export class FakePatientStore implements PatientStore {
  readonly writes: { patientId: string; highlights: string }[] = [];
  readonly docs = new Map<string, PatientDoc>();
  failReads = false;
  failWrites = false;

  constructor(patients: Record<string, PatientDoc> = { [PATIENT_ID]: { ...newPatientDoc("Live patient", CLINICIAN_EMAIL), sharingConsent: "granted" } }) {
    for (const [id, doc] of Object.entries(patients)) this.docs.set(id, { ...doc });
  }

  async get(patientId: string) {
    if (this.failReads) throw new Error("read failed");
    const doc = this.docs.get(patientId);
    return doc ? { ...doc } : undefined;
  }

  async setIntakeHighlights(patientId: string, highlights: string) {
    if (this.failWrites) throw new Error("write failed");
    const doc = this.docs.get(patientId);
    if (!doc) throw new Error("no such document");
    this.writes.push({ patientId, highlights });
    this.docs.set(patientId, { ...doc, intakeHighlights: highlights });
  }
}

/** Returns `output` (or runs `behaviour`) and records every request. */
export class FakeTextModel implements TextModelClient {
  readonly requests: TextRequest[] = [];
  constructor(private readonly behaviour: string | null | ((request: TextRequest) => Promise<string | null>)) {}

  async generateText(request: TextRequest) {
    this.requests.push(request);
    return typeof this.behaviour === "function" ? this.behaviour(request) : this.behaviour;
  }
}

/** A text model that fails the way an SDK error can: status, message and body echoing the input. */
export function failingTextModel(status = 500): FakeTextModel {
  return new FakeTextModel(async (request) => {
    const error = new Error(`Request failed for input: ${request.input}`) as Error & { status: number; body: unknown };
    error.status = status;
    error.body = { request };
    throw error;
  });
}

export function words(n: number, word = "word"): string {
  return Array.from({ length: n }, (_, i) => `${word}${i + 1}`).join(" ");
}
