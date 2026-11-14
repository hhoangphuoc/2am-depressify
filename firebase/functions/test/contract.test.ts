import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as types from "../src/types";
import * as dashboard from "../../hosting/js/lib/contract.js";

// contract.json is written by core's JVM tests (ContractExportTest) from the Kotlin data contract.
const contract = JSON.parse(readFileSync(join(__dirname, "fixtures", "contract.json"), "utf8"));

// One complete sample per document. Typed against the interfaces, so `npm run typecheck` fails
// when a field is missing or extra; the tests below then compare the field names with Kotlin.
const samples: Record<string, object> = {
  PatientDoc: types.newPatientDoc("Live patient", "clinician@example.com"),
  DailyDoc: { date: "2026-11-13", values: {}, vsBaseline: {}, composite: null, demoOverride: false } satisfies types.DailyDoc,
  Consent: { subject: "steps", granted: true, changedAtMillis: 1 } satisfies types.Consent,
  VoiceCue: { label: "flat tone", intensity: 2, heard: "short answers" } satisfies types.VoiceCue,
  CheckIn: {
    id: "c1", startedAtMillis: 1, endedAtMillis: null, mood: null, energy: null, sleepQuality: null, voiceCues: [], crisis: false,
  } satisfies types.CheckIn,
  Summary: {
    checkInId: "c1", createdAtMillis: 1, mood: null, energy: null, sleepQuality: null, sleepLine: "", themes: [],
    voiceCues: [], suggestion: null, previousOutcome: null, quotes: [],
  } satisfies types.Summary,
  Suggestion: {
    id: "s1", kind: "walk", details: "", suggestedAtMillis: 1, status: "proposed", booked: false, tried: null, felt: null,
    objectiveChange: null, outcomeScore: null,
  } satisfies types.Suggestion,
  Flag: { level: "red", kind: "silent", reason: "", raisedAtMillis: 1, clearedAtMillis: null } satisfies types.Flag,
  Visit: { date: "2026-11-13", questionnaire: null, score: null } satisfies types.Visit,
  Digest: { isoWeek: "2026-W46", text: "", generatedAtMillis: 1 } satisfies types.Digest,
  MailMessage: { subject: "", text: "" } satisfies types.MailMessage,
  MailDoc: { to: "c@example.com", message: { subject: "", text: "" } } satisfies types.MailDoc,
};

describe("TypeScript mirror of the data contract", () => {
  it("has the same Signals, keys and directions", () => {
    expect(types.SIGNALS.map((s) => ({ key: s.key, direction: s.direction }))).toEqual(contract.signals);
  });

  it("has the same enumerations", () => {
    expect(types.SIGNAL_DIRECTIONS).toEqual(contract.enums.SignalDirection);
    expect(types.FLAG_LEVELS).toEqual(contract.enums.FlagLevel);
    expect(types.FLAG_KINDS).toEqual(contract.enums.FlagKind);
    expect(types.SUGGESTION_KINDS).toEqual(contract.enums.SuggestionKind);
    expect(types.SUGGESTION_STATUSES).toEqual(contract.enums.SuggestionStatus);
    expect(types.HEALTH_SOURCES).toEqual(contract.enums.HealthSource);
    expect(types.SHARING_CONSENTS).toEqual(contract.enums.SharingConsent);
    expect(types.CONSENT_PURPOSES).toEqual(contract.enums.ConsentPurpose);
    expect(types.QUESTIONNAIRE_KINDS).toEqual(contract.enums.QuestionnaireKind);
  });

  it("has the same collections", () => {
    expect(types.COLLECTIONS.patients).toEqual(contract.collections.patients);
    expect(types.PATIENT_SUBCOLLECTIONS).toEqual(contract.collections.patientSubcollections);
    expect(types.COLLECTIONS.mail).toEqual(contract.collections.mail);
  });

  it.each(Object.keys(contract.documents))("%s has the same fields", (name) => {
    expect(samples[name], `no sample for ${name}`).toBeDefined();
    expect(Object.keys(samples[name]).sort()).toEqual([...contract.documents[name]].sort());
  });

  it("creates a new Patient with the same defaults as Kotlin, nulls included", () => {
    expect(types.newPatientDoc("Live patient", "clinician@example.com")).toEqual(contract.defaults.newPatient);
  });
});

describe("dashboard copy of the data contract", () => {
  it("matches the TypeScript mirror", () => {
    expect(dashboard.SIGNALS).toEqual(types.SIGNALS);
    expect(dashboard.FLAG_LEVELS).toEqual(types.FLAG_LEVELS);
    expect(dashboard.FLAG_KINDS).toEqual(types.FLAG_KINDS);
    expect(dashboard.SUGGESTION_KINDS).toEqual(types.SUGGESTION_KINDS);
    expect(dashboard.SUGGESTION_STATUSES).toEqual(types.SUGGESTION_STATUSES);
    expect(dashboard.HEALTH_SOURCES).toEqual(types.HEALTH_SOURCES);
    expect(dashboard.SHARING_CONSENTS).toEqual(types.SHARING_CONSENTS);
    expect(dashboard.CONSENT_PURPOSES).toEqual(types.CONSENT_PURPOSES);
    expect(dashboard.QUESTIONNAIRE_KINDS).toEqual(types.QUESTIONNAIRE_KINDS);
    expect(dashboard.COLLECTIONS).toEqual(types.COLLECTIONS);
    expect(dashboard.PATIENT_SUBCOLLECTIONS).toEqual(types.PATIENT_SUBCOLLECTIONS);
  });
});
