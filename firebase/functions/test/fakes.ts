// Fakes for the function handlers: in-memory stores and a scripted text model.
import type { TextModelClient, TextRequest } from "../src/gemini";
import type { CallerAuth } from "../src/clinician";
import type { AlertStore } from "../src/alertFunctions";
import { finishWrites, type FinishContent } from "../src/checkIn";
import type { CheckInStore } from "../src/checkInFunctions";
import type { LiveTokenClient, LiveTokenRequest } from "../src/live";
import type { DigestStore } from "../src/digestFunctions";
import type { PatientStore } from "../src/intakeFunctions";
import { newPatientDoc, type CheckIn, type DailyDoc, type Digest, type MailDoc, type PatientDoc, type Summary, type Suggestion } from "../src/types";

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

export interface DigestPatientData {
  patient: PatientDoc;
  summaries?: Summary[];
  days?: DailyDoc[];
}

/** Patients with their Summaries and daily records; records every Digest written. */
export class FakeDigestStore implements DigestStore {
  readonly digests = new Map<string, Map<string, Digest>>();
  readonly writes: { patientId: string; digest: Digest }[] = [];
  failWritesFor = new Set<string>();

  constructor(private readonly data: Record<string, DigestPatientData>) {}

  async getPatient(patientId: string) {
    const entry = this.data[patientId];
    return entry ? { ...entry.patient } : undefined;
  }

  async listPatients() {
    return Object.entries(this.data).map(([id, entry]) => ({ id, patient: { ...entry.patient } }));
  }

  async summaries(patientId: string, startMillis: number, endMillis: number) {
    return (this.data[patientId]?.summaries ?? []).filter((s) => s.createdAtMillis >= startMillis && s.createdAtMillis < endMillis);
  }

  async days(patientId: string, weekStart: string, weekEnd: string) {
    return (this.data[patientId]?.days ?? []).filter((d) => d.date >= weekStart && d.date <= weekEnd);
  }

  async writeDigest(patientId: string, digest: Digest) {
    if (this.failWritesFor.has(patientId)) throw new Error("write failed");
    this.writes.push({ patientId, digest });
    if (!this.digests.has(patientId)) this.digests.set(patientId, new Map());
    this.digests.get(patientId)!.set(digest.isoWeek, digest);
  }
}

/** Patient records and the `mail` collection; `createMail` refuses an id that exists, like `create()`. */
export class FakeAlertStore implements AlertStore {
  readonly mail = new Map<string, MailDoc>();
  reads = 0;
  creates = 0;
  failReads = false;
  failWrites = false;

  constructor(private readonly patients: Record<string, Partial<PatientDoc>>) {}

  async getPatient(patientId: string) {
    this.reads += 1;
    if (this.failReads) throw new Error("read failed");
    const patient = this.patients[patientId];
    return patient ? { ...patient } : undefined;
  }

  async createMail(id: string, mail: MailDoc) {
    this.creates += 1;
    if (this.failWrites) throw new Error("write failed");
    if (this.mail.has(id)) return false;
    this.mail.set(id, mail);
    return true;
  }
}

/** Mints fake tokens and records every request; `fail` makes it throw like a failed HTTP call. */
export class FakeLiveTokens implements LiveTokenClient {
  readonly requests: LiveTokenRequest[] = [];
  fail: number | null = null;
  private count = 0;

  async createToken(request: LiveTokenRequest) {
    this.requests.push(request);
    if (this.fail !== null) {
      const error = new Error(`Token request failed: ${request.bidiGenerateContentSetup.systemInstruction.parts[0].text}`) as Error & { status: number };
      error.status = this.fail;
      throw error;
    }
    this.count += 1;
    return `auth_tokens/fake-token-${this.count}`;
  }
}

/** Patient records with their Check-ins, Summaries, Consents and Suggestions, in memory. */
export class FakeCheckInStore implements CheckInStore {
  readonly patients = new Map<string, Partial<PatientDoc>>();
  readonly checkIns = new Map<string, Partial<CheckIn>>();
  readonly summaries = new Map<string, Summary>();
  readonly consents = new Map<string, boolean>();
  readonly suggestions = new Map<string, Partial<Suggestion>>();
  /** Every document write, in order, as `path` and the data written. */
  readonly writes: { path: string; data: unknown }[] = [];
  failReads = false;
  failWrites = false;

  constructor(patients: Record<string, Partial<PatientDoc>> = { [PATIENT_ID]: { ...newPatientDoc("Live patient", CLINICIAN_EMAIL), sharingConsent: "granted" } }) {
    for (const [id, doc] of Object.entries(patients)) this.patients.set(id, { ...doc });
  }

  private key(patientId: string, id: string) {
    return `${patientId}/${id}`;
  }

  async getPatient(patientId: string) {
    if (this.failReads) throw new Error("read failed");
    const doc = this.patients.get(patientId);
    return doc ? structuredClone(doc) : undefined;
  }

  async getCheckIn(patientId: string, checkInId: string) {
    if (this.failReads) throw new Error("read failed");
    const doc = this.checkIns.get(this.key(patientId, checkInId));
    return doc ? structuredClone(doc) : undefined;
  }

  async getConsent(patientId: string, subject: "ratings" | "voice_cues") {
    if (this.failReads) throw new Error("read failed");
    return this.consents.get(this.key(patientId, subject)) ?? null;
  }

  async getSuggestion(patientId: string, suggestionId: string) {
    if (this.failReads) throw new Error("read failed");
    const doc = this.suggestions.get(this.key(patientId, suggestionId));
    return doc ? structuredClone(doc) : undefined;
  }

  async createCheckIn(patientId: string, checkIn: CheckIn) {
    if (this.failWrites) throw new Error("write failed");
    const key = this.key(patientId, checkIn.id);
    if (this.checkIns.has(key)) throw new Error("already exists");
    this.checkIns.set(key, structuredClone(checkIn));
    this.writes.push({ path: `patients/${patientId}/checkIns/${checkIn.id}`, data: structuredClone(checkIn) });
  }

  async writeFinish(patientId: string, checkInId: string, content: FinishContent, nowMillis: number) {
    if (this.failWrites) throw new Error("write failed");
    const key = this.key(patientId, checkInId);
    const patient = this.patients.get(patientId);
    const checkIn = this.checkIns.get(key);
    if (!patient || !checkIn) throw new Error("missing");
    const writes = finishWrites({ patient, checkIn, summary: this.summaries.get(key) }, checkInId, content, nowMillis);
    this.summaries.set(key, structuredClone(writes.summary));
    this.checkIns.set(key, { ...checkIn, ...structuredClone(writes.checkIn) });
    this.patients.set(patientId, { ...patient, ...writes.patient });
    this.writes.push(
      { path: `patients/${patientId}/summaries/${checkInId}`, data: structuredClone(writes.summary) },
      { path: `patients/${patientId}/checkIns/${checkInId}`, data: structuredClone(writes.checkIn) },
      { path: `patients/${patientId}`, data: { ...writes.patient } },
    );
    return structuredClone(writes.summary);
  }
}
