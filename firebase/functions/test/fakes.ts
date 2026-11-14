// Fakes for the function handlers: in-memory stores and a scripted text model.
import type { TextModelClient, TextRequest } from "../src/gemini";
import type { CallerAuth } from "../src/clinician";
import type { AlertStore } from "../src/alertFunctions";
import type { DigestStore } from "../src/digestFunctions";
import type { PatientStore } from "../src/intakeFunctions";
import type { SilencePlan, StoredFlag } from "../src/silence";
import type { SilenceStore } from "../src/silenceFunctions";
import { newPatientDoc, type DailyDoc, type Digest, type Flag, type MailDoc, type PatientDoc, type Summary } from "../src/types";

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

/**
 * Patient records and their flags, for the silence check. `raiseSilent` behaves like the Admin SDK
 * store's transaction: it reads the record as it is now and the Patient's silent flags, and applies
 * the plan's flag create and Patient update together, or nothing.
 */
export class FakeSilenceStore implements SilenceStore {
  readonly patients = new Map<string, Partial<PatientDoc>>();
  readonly flags = new Map<string, Map<string, Flag>>();
  /** Patient ids whose transaction throws, with a message that echoes the record. */
  failFor = new Set<string>();
  /** Changes a record between the listing and the transaction, as a phone checking in would. */
  beforeTransaction: ((patientId: string, store: FakeSilenceStore) => void) | null = null;
  transactions = 0;

  constructor(patients: Record<string, Partial<PatientDoc>>, flags: Record<string, Record<string, Flag>> = {}) {
    for (const [id, doc] of Object.entries(patients)) this.patients.set(id, { ...doc });
    for (const [id, docs] of Object.entries(flags)) this.flags.set(id, new Map(Object.entries(docs)));
  }

  flagsOf(patientId: string): Map<string, Flag> {
    if (!this.flags.has(patientId)) this.flags.set(patientId, new Map());
    return this.flags.get(patientId)!;
  }

  async listPatients() {
    return [...this.patients.entries()].map(([id, p]) => ({
      id,
      patient: { sharingConsent: p.sharingConsent, synthetic: p.synthetic, lastSeenAtMillis: p.lastSeenAtMillis },
    }));
  }

  async raiseSilent(patientId: string, plan: (patient: Partial<PatientDoc> | undefined, silentFlags: StoredFlag[]) => SilencePlan) {
    this.transactions += 1;
    this.beforeTransaction?.(patientId, this);
    const patient = this.patients.get(patientId);
    if (this.failFor.has(patientId)) throw new Error(`transaction failed for ${JSON.stringify(patient)}`);
    const silent = [...this.flagsOf(patientId).entries()]
      .filter(([, flag]) => flag.kind === "silent")
      .map(([id, flag]) => ({ id, flag: { ...flag } }));
    const result = plan(patient ? { ...patient } : undefined, silent);
    if (result.raise) {
      if (this.flagsOf(patientId).has(result.flagId)) throw Object.assign(new Error("already exists"), { code: 6 });
      this.flagsOf(patientId).set(result.flagId, result.flag);
      this.patients.set(patientId, { ...patient, ...result.update });
    }
    return result;
  }
}
