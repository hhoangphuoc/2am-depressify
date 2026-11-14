// Shared setup for the security rules tests. Needs the Auth and Firestore emulators:
//   cd firebase && firebase emulators:exec --only auth,firestore --project demo-twoam "npm --prefix functions run test:emulator"
//
// Every sample document is typed against the data contract in src/types.ts, so `npm run typecheck`
// fails when the contract changes and these fixtures do not.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import {
  newPatientDoc,
  type CheckIn,
  type Consent,
  type DailyDoc,
  type Digest,
  type Flag,
  type MailDoc,
  type PATIENT_SUBCOLLECTIONS,
  type PatientDoc,
  type Suggestion,
  type Summary,
  type Visit,
} from "../../src/types";

/** The demo Clinician: `DemoConfig.CLINICIAN_EMAIL` in `shared`, and the one the rules let a new Patient link to. */
export const CLINICIAN = "clinician@example.com";
export const OTHER_CLINICIAN = "other-clinician@example.com";

/** Patient ids. A Patient's id is their anonymous auth uid. */
export const ALICE = "alice"; // linked to CLINICIAN, sharing granted, amber with one open flag
export const BOB = "bob"; // linked to OTHER_CLINICIAN
export const DEMO = "demo-declining"; // a synthetic Demo Patient linked to CLINICIAN
export const STRANGER = "stranger"; // a signed-in user with no record and no email

export const AMBER_REASON = "Sleep has been worse than usual on each of the last three nights.";
export const CRISIS_REASON = "Signs of self-harm risk came up during a Check-in.";

export type Subcollection = (typeof PATIENT_SUBCOLLECTIONS)[number];

export const daily: DailyDoc = {
  date: "2026-11-13",
  values: { sleepMinutes: 300, steps: null },
  vsBaseline: { sleepMinutes: -1.4, steps: null },
  composite: -1.4,
  demoOverride: false,
};
export const consent: Consent = { subject: "steps", granted: true, changedAtMillis: 1_700_000_000_000 };
export const checkIn: CheckIn = {
  id: "c1",
  startedAtMillis: 1_700_000_000_000,
  endedAtMillis: 1_700_000_180_000,
  mood: 2,
  energy: 3,
  sleepQuality: 2,
  voiceCues: [{ label: "flat tone", intensity: 2, heard: "short answers" }],
  crisis: false,
};
export const summary: Summary = {
  checkInId: "c1",
  createdAtMillis: 1_700_000_200_000,
  mood: 2,
  energy: 3,
  sleepQuality: 2,
  sleepLine: "Slept less than usual.",
  themes: ["work stress"],
  voiceCues: [],
  suggestion: "A short walk by the river",
  previousOutcome: null,
  quotes: [],
};
export const suggestion: Suggestion = {
  id: "s1",
  kind: "walk",
  details: "A short walk by the river",
  suggestedAtMillis: 1_700_000_100_000,
  status: "accepted",
  booked: false,
  tried: null,
  felt: null,
  objectiveChange: null,
  outcomeScore: null,
};
export const openFlag: Flag = {
  level: "amber",
  kind: "poor_sleep",
  reason: AMBER_REASON,
  raisedAtMillis: 1_700_000_000_000,
  clearedAtMillis: null,
};
export const crisisFlag: Flag = {
  level: "red",
  kind: "crisis",
  reason: CRISIS_REASON,
  raisedAtMillis: 1_700_000_300_000,
  clearedAtMillis: null,
};
export const visit: Visit = { date: "2026-10-23", questionnaire: "phq9", score: 7 };
export const digest: Digest = {
  isoWeek: "2026-W46",
  weekStart: "2026-11-09",
  weekEnd: "2026-11-15",
  summaryCount: 5,
  text: "A steady week.",
  generatedAtMillis: 1_700_000_000_000,
};
export const mail: MailDoc = {
  to: CLINICIAN,
  message: { subject: "[RED] Alice", text: "A red flag was raised. Open the dashboard." },
};

/** One document per Patient collection, keyed by collection. A new collection in the contract must add one here. */
export const SAMPLES: Record<Subcollection, { id: string; data: object }> = {
  daily: { id: daily.date, data: daily },
  consents: { id: consent.subject, data: consent },
  checkIns: { id: checkIn.id, data: checkIn },
  summaries: { id: summary.checkInId, data: summary },
  suggestions: { id: suggestion.id, data: suggestion },
  flags: { id: "f1", data: openFlag },
  visits: { id: "v1", data: visit },
  digests: { id: digest.isoWeek, data: digest },
};
export const SUBCOLLECTIONS = Object.keys(SAMPLES) as Subcollection[];

/** The collections a Patient reads and writes. Visits and Digests are read-only to them; flags are append-only. */
export const PATIENT_WRITABLE: Subcollection[] = ["daily", "consents", "checkIns", "summaries", "suggestions"];
/** The collections the Clinician may not write at all. */
export const CLINICIAN_READ_ONLY: Subcollection[] = ["daily", "consents", "checkIns", "summaries", "suggestions", "digests"];

export const samplePath = (patientId: string, sub: Subcollection) => `patients/${patientId}/${sub}/${SAMPLES[sub].id}`;

/** When Alice granted sharing. */
export const SHARED_AT = 1_699_000_000_000;

// Alice has granted sharing, so her Clinician can read her (issue #29). A new record is undecided.
export const alice: PatientDoc = {
  ...newPatientDoc("Alice", CLINICIAN),
  flagLevel: "amber",
  flagReasons: [AMBER_REASON],
  sharingConsent: "granted",
  sharingChangedAtMillis: SHARED_AT,
};
export const bob: PatientDoc = newPatientDoc("Bob", OTHER_CLINICIAN);
export const demo: PatientDoc = { ...newPatientDoc("Demo declining", CLINICIAN), synthetic: true, healthSource: "synthetic" };

export async function startEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: "demo-twoam",
    firestore: { rules: readFileSync(join(__dirname, "..", "..", "..", "firestore.rules"), "utf8") },
  });
}

/** Alice, Bob and a Demo Patient, each with one document in every collection, plus one mail document. */
export async function seed(env: RulesTestEnvironment): Promise<void> {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [id, record] of [[ALICE, alice], [BOB, bob], [DEMO, demo]] as const) {
      await setDoc(doc(db, "patients", id), record);
      for (const sub of SUBCOLLECTIONS) await setDoc(doc(db, samplePath(id, sub)), SAMPLES[sub].data);
    }
    await setDoc(doc(db, "mail/m1"), mail);
  });
}

/** A signed-in Patient: anonymous auth, so the token has no email. */
export const asPatient = (env: RulesTestEnvironment, uid: string) =>
  env.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }).firestore();

/** A signed-in Clinician: email and password, so the token carries the email (unverified in the emulator). */
export const asClinician = (env: RulesTestEnvironment, email: string) =>
  env.authenticatedContext(`clinician-${email}`, { email, firebase: { sign_in_provider: "password" } }).firestore();

export const signedOut = (env: RulesTestEnvironment) => env.unauthenticatedContext().firestore();
