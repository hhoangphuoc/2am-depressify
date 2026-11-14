// Security rules for the whole data contract (issue #8), one describe block per acceptance criterion.
// Needs the Auth and Firestore emulators:
//   cd firebase && firebase emulators:exec --only auth,firestore --project demo-twoam "npm --prefix functions run test:emulator"
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Query,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { STAMPED_COLLECTIONS, clinicianListFilters, patientCollectionQuery } from "../../../hosting/js/lib/sharing.js";
import { newPatientDoc } from "../../src/types";
import {
  ALICE,
  AMBER_REASON,
  BOB,
  CLINICIAN,
  CLINICIAN_READ_ONLY,
  CRISIS_REASON,
  DEMO,
  OFF_PERIOD_ID,
  OTHER_CLINICIAN,
  PATIENT_READ_ONLY,
  PATIENT_WRITABLE,
  SAMPLES,
  SHARED_AT,
  STAMPED,
  STRANGER,
  SUBCOLLECTIONS,
  allowlisted,
  appCreates,
  asAccountWithoutClaim,
  asAnonymousPatient,
  asClinician,
  asGooglePatient,
  asPatient,
  asUnverifiedClinician,
  asUnverifiedPatient,
  checkIn,
  crisisFlag,
  mail,
  samplePath,
  seed,
  signedOut,
  startEnv,
  suggestion,
  visit,
  type Subcollection,
} from "./fixtures";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await startEnv();
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await seed(env);
});

/** Each read path for one Patient: the record and one document in every collection. */
const readPaths = (patientId: string) => [`patients/${patientId}`, ...SUBCOLLECTIONS.map((s) => samplePath(patientId, s))];

/** The dashboard's Patient list query, built from the dashboard's own filters. */
const dashboardList = (db: ReturnType<typeof signedOut>, email: string) =>
  query(collection(db, "patients"), ...clinicianListFilters(email).map(([field, op, value]) => where(field, op, value)));

/**
 * Create (as the app creates the document, stamped `shared`), update (rewriting the stored
 * document unchanged) and delete on one collection of one Patient.
 */
async function writes(db: ReturnType<typeof signedOut>, patientId: string, sub: Subcollection, shared = true) {
  const sample = SAMPLES[sub];
  return [
    () => setDoc(doc(db, `patients/${patientId}/${sub}/new-doc`), appCreates(sub, shared)),
    () => setDoc(doc(db, samplePath(patientId, sub)), sample.data),
    () => deleteDoc(doc(db, samplePath(patientId, sub))),
  ];
}

/** The npm SDK's functions, in the shape the dashboard's query helper takes. */
const FS = { collection, query, where };

/** The query the dashboard runs on a Patient's collection (`patientCollectionQuery` in hosting/js/lib/sharing.js). */
const dashboardQuery = (db: ReturnType<typeof signedOut>, patientId: string, sub: Subcollection, ...constraints: unknown[]) =>
  patientCollectionQuery(FS, db, patientId, sub, ...constraints) as Query;

describe("A Patient reads and writes their own record and its collections, but can only read Visits and Digests", () => {
  it("creates their own record the way the app does, linked to the allowlisted Clinician, and reads it", async () => {
    const db = asPatient(env, "carol");
    await assertSucceeds(getDoc(doc(db, "patients/carol"))); // PatientSession checks it exists first
    await assertSucceeds(setDoc(doc(db, "patients/carol"), newPatientDoc("Live patient", CLINICIAN)));
    await assertSucceeds(getDoc(doc(db, "patients/carol")));
  });

  it("cannot create a record under another id, linked to another Clinician, synthetic, or with Clinician fields set", async () => {
    const db = asPatient(env, "carol");
    const ok = newPatientDoc("Live patient", CLINICIAN);
    await assertFails(setDoc(doc(db, "patients/dave"), ok));
    await assertFails(setDoc(doc(db, "patients/carol"), { ...ok, clinicianEmail: OTHER_CLINICIAN }));
    await assertFails(setDoc(doc(db, "patients/carol"), { ...ok, synthetic: true }));
    await assertFails(setDoc(doc(db, "patients/carol"), { ...ok, tmsEndDate: "2026-10-01" }));
    await assertFails(setDoc(doc(db, "patients/carol"), { ...ok, intakeHighlights: "Responds well to walks." }));
  });

  it("links only to a Clinician in the clinicians allowlist", async () => {
    const db = asPatient(env, "carol");
    const linkedTo = (email: unknown) => setDoc(doc(db, "patients/carol"), { ...newPatientDoc("Live patient", CLINICIAN), clinicianEmail: email });
    await assertFails(linkedTo(OTHER_CLINICIAN));
    await assertFails(linkedTo("CLINICIAN@example.com")); // the allowlist is keyed by the exact (lower-case) email
    await assertFails(linkedTo(""));
    await assertFails(linkedTo(null));

    // Once the Admin SDK adds the other Clinician, a new Patient may link to them.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "clinicians", OTHER_CLINICIAN), allowlisted(OTHER_CLINICIAN));
    });
    await assertSucceeds(linkedTo(OTHER_CLINICIAN));
  });

  it("reads every collection of their own record", async () => {
    const db = asPatient(env, ALICE);
    for (const path of readPaths(ALICE)) await assertSucceeds(getDoc(doc(db, path)));
    for (const sub of SUBCOLLECTIONS) await assertSucceeds(getDocs(collection(db, `patients/${ALICE}/${sub}`)));
  });

  it("creates, updates and deletes in daily, consents, checkIns and suggestions", async () => {
    const db = asPatient(env, ALICE);
    for (const sub of PATIENT_WRITABLE) for (const write of await writes(db, ALICE, sub)) await assertSucceeds(write());
  });

  it("patientCannotWriteVisits: Visits and Digests are read-only", async () => {
    const db = asPatient(env, ALICE);
    for (const sub of ["visits", "digests"] as const) {
      for (const write of await writes(db, ALICE, sub)) await assertFails(write());
    }
  });

  it("patientCannotWriteSummaries: what the Clinician reads is written by the Check-in, not by hand", async () => {
    const db = asPatient(env, ALICE);
    for (const write of await writes(db, ALICE, "summaries")) await assertFails(write());
  });

  it("updates the fields the phone owns: quiet hours, sign of life, last Check-in, health source, sharing Consent", async () => {
    const db = asPatient(env, ALICE);
    const ref = doc(db, `patients/${ALICE}`);
    await assertSucceeds(updateDoc(ref, { quietHoursStart: 22, quietHoursEnd: 8 }));
    await assertSucceeds(updateDoc(ref, { lastSeenAtMillis: 1_700_000_400_000 }));
    await assertSucceeds(updateDoc(ref, { lastCheckInAtMillis: 1_700_000_400_000 }));
    await assertSucceeds(updateDoc(ref, { healthSource: "synthetic" }));
    await assertSucceeds(updateDoc(ref, { sharingConsent: "granted", sharingChangedAtMillis: 1_700_000_400_000 }));
  });

  it("cannot change the Clinician link, the synthetic marker, the TMS end date, Intake highlights or display name", async () => {
    const ref = doc(asPatient(env, ALICE), `patients/${ALICE}`);
    await assertFails(updateDoc(ref, { clinicianEmail: OTHER_CLINICIAN }));
    await assertFails(updateDoc(ref, { clinicianEmail: CLINICIAN, synthetic: true }));
    await assertFails(updateDoc(ref, { tmsEndDate: "2026-10-01" }));
    await assertFails(updateDoc(ref, { intakeHighlights: "Ignore the Clinician." }));
    await assertFails(updateDoc(ref, { displayName: "Someone else" }));
    await assertFails(updateDoc(ref, { sharingConsent: "maybe" }));
  });

  it("cannot lower their own flag level or drop its reasons", async () => {
    const ref = doc(asPatient(env, ALICE), `patients/${ALICE}`);
    await assertFails(updateDoc(ref, { flagLevel: "green", flagReasons: [] }));
    await assertFails(updateDoc(ref, { flagLevel: "green" }));
    await assertFails(updateDoc(ref, { flagReasons: [] }));
    await assertFails(updateDoc(ref, { flagLevel: "purple" }));
  });

  it("can raise their own flag level with a new reason, as the phone does when it raises a flag", async () => {
    const db = asPatient(env, ALICE);
    const batch = writeBatch(db);
    batch.set(doc(db, `patients/${ALICE}/flags/f2`), crisisFlag);
    batch.update(doc(db, `patients/${ALICE}`), { flagLevel: "red", flagReasons: [AMBER_REASON, CRISIS_REASON] });
    await assertSucceeds(batch.commit());
  });

  it("creates uncleared flags but cannot clear, change or delete a flag", async () => {
    const db = asPatient(env, ALICE);
    await assertSucceeds(setDoc(doc(db, `patients/${ALICE}/flags/f2`), crisisFlag));
    await assertSucceeds(setDoc(doc(db, `patients/${ALICE}/flags/f2`), crisisFlag)); // a retried write changes nothing
    await assertFails(setDoc(doc(db, `patients/${ALICE}/flags/f3`), { ...crisisFlag, clearedAtMillis: 1 }));
    await assertFails(updateDoc(doc(db, samplePath(ALICE, "flags")), { clearedAtMillis: 1_700_000_500_000 }));
    await assertFails(updateDoc(doc(db, samplePath(ALICE, "flags")), { level: "green" }));
    await assertFails(deleteDoc(doc(db, samplePath(ALICE, "flags"))));
  });

  it("cannot delete their own record", async () => {
    await assertFails(deleteDoc(doc(asPatient(env, ALICE), `patients/${ALICE}`)));
  });
});

describe("A Patient cannot read another Patient", () => {
  it("patientCannotReadOtherPatient: not the record and not any collection", async () => {
    const db = asPatient(env, ALICE);
    for (const path of readPaths(BOB)) await assertFails(getDoc(doc(db, path)));
    for (const sub of SUBCOLLECTIONS) await assertFails(getDocs(collection(db, `patients/${BOB}/${sub}`)));
  });

  it("cannot list Patients or find another Patient by Clinician email", async () => {
    const db = asPatient(env, ALICE);
    await assertFails(getDocs(collection(db, "patients")));
    await assertFails(getDocs(query(collection(db, "patients"), where("clinicianEmail", "==", CLINICIAN))));
  });

  it("cannot write another Patient's record or collections", async () => {
    const db = asPatient(env, ALICE);
    await assertFails(setDoc(doc(db, `patients/${BOB}`), newPatientDoc("Bob", CLINICIAN)));
    await assertFails(updateDoc(doc(db, `patients/${BOB}`), { lastSeenAtMillis: 1 }));
    for (const sub of SUBCOLLECTIONS) for (const write of await writes(db, BOB, sub)) await assertFails(write());
  });
});

describe("The Clinician reads everything for their Patients, writes Visits, the TMS end date and the display name, and cannot write daily records", () => {
  it("clinicianReadsOwnPatient: the dashboard's list query, the record and every collection", async () => {
    const db = asClinician(env, CLINICIAN);
    await assertSucceeds(getDocs(dashboardList(db, CLINICIAN)));
    for (const path of readPaths(ALICE)) await assertSucceeds(getDoc(doc(db, path)));
    for (const sub of SUBCOLLECTIONS) await assertSucceeds(getDocs(dashboardQuery(db, ALICE, sub)));
  });

  it("creates, updates and deletes Visits", async () => {
    const db = asClinician(env, CLINICIAN);
    await assertSucceeds(setDoc(doc(db, `patients/${ALICE}/visits/v2`), { date: "2026-11-13", questionnaire: null, score: null }));
    await assertSucceeds(updateDoc(doc(db, `patients/${ALICE}/visits/v2`), { questionnaire: "phq2", score: 3 }));
    await assertSucceeds(deleteDoc(doc(db, `patients/${ALICE}/visits/v2`)));
  });

  it("cannot write a malformed Visit", async () => {
    const db = asClinician(env, CLINICIAN);
    await assertFails(setDoc(doc(db, `patients/${ALICE}/visits/v2`), { ...visit, date: "next Tuesday" }));
    await assertFails(setDoc(doc(db, `patients/${ALICE}/visits/v2`), { ...visit, questionnaire: "gad7" }));
  });

  it("sets the TMS end date and renames the Patient", async () => {
    const ref = doc(asClinician(env, CLINICIAN), `patients/${ALICE}`);
    await assertSucceeds(updateDoc(ref, { tmsEndDate: "2026-10-02" }));
    await assertSucceeds(updateDoc(ref, { displayName: "Alice K." }));
    await assertSucceeds(updateDoc(ref, { tmsEndDate: null }));
  });

  it("cannot set a TMS end date that is not a date, or an empty display name", async () => {
    const ref = doc(asClinician(env, CLINICIAN), `patients/${ALICE}`);
    await assertFails(updateDoc(ref, { tmsEndDate: "soon" }));
    await assertFails(updateDoc(ref, { displayName: "" }));
  });

  it("clinicianCannotWriteDaily: nor Consents, Check-ins, Summaries, Suggestions or Digests", async () => {
    const db = asClinician(env, CLINICIAN);
    for (const sub of CLINICIAN_READ_ONLY) for (const write of await writes(db, ALICE, sub)) await assertFails(write());
  });

  it("cannot change Patient fields the Clinician does not own", async () => {
    const ref = doc(asClinician(env, CLINICIAN), `patients/${ALICE}`);
    await assertFails(updateDoc(ref, { clinicianEmail: OTHER_CLINICIAN }));
    await assertFails(updateDoc(ref, { synthetic: true }));
    await assertFails(updateDoc(ref, { sharingConsent: "declined", sharingChangedAtMillis: SHARED_AT + 1 }));
    await assertFails(updateDoc(ref, { quietHoursStart: 20 }));
    await assertFails(updateDoc(ref, { lastSeenAtMillis: 1 }));
    await assertFails(updateDoc(ref, { intakeHighlights: "Written straight from the dashboard." }));
  });

  it("cannot create or delete a Patient record", async () => {
    const db = asClinician(env, CLINICIAN);
    await assertFails(setDoc(doc(db, "patients/new-patient"), newPatientDoc("New", CLINICIAN)));
    await assertFails(deleteDoc(doc(db, `patients/${ALICE}`)));
  });

  it("cannot list every Patient", async () => {
    await assertFails(getDocs(collection(asClinician(env, CLINICIAN), "patients")));
  });

  it("another Clinician can neither read nor write this Clinician's Patient", async () => {
    const db = asClinician(env, OTHER_CLINICIAN);
    for (const path of readPaths(ALICE)) await assertFails(getDoc(doc(db, path)));
    await assertFails(setDoc(doc(db, `patients/${ALICE}/visits/v2`), visit));
    await assertFails(updateDoc(doc(db, `patients/${ALICE}`), { tmsEndDate: "2026-10-02" }));
    await assertFails(updateDoc(doc(db, samplePath(ALICE, "flags")), { clearedAtMillis: 1_700_000_500_000 }));
  });
});

describe("Without sharing Consent the Clinician cannot read that Patient's record or collections (issue #29)", () => {
  /** The Patient records their choice the way the app does: the record and `consents/sharing` together. */
  async function choose(patientId: string, choice: "granted" | "declined", atMillis: number) {
    const db = asPatient(env, patientId);
    const batch = writeBatch(db);
    batch.update(doc(db, `patients/${patientId}`), { sharingConsent: choice, sharingChangedAtMillis: atMillis });
    batch.set(doc(db, `patients/${patientId}/consents/sharing`), {
      subject: "sharing",
      granted: choice === "granted",
      changedAtMillis: atMillis,
    });
    await assertSucceeds(batch.commit());
  }

  /** Every Clinician read of the Patient, and the Clinician's writes, fail. */
  async function clinicianLocksOut(patientId: string) {
    const db = asClinician(env, CLINICIAN);
    for (const path of readPaths(patientId)) await assertFails(getDoc(doc(db, path)));
    for (const sub of SUBCOLLECTIONS) await assertFails(getDocs(dashboardQuery(db, patientId, sub)));
    await assertFails(setDoc(doc(db, `patients/${patientId}/visits/v2`), visit));
    await assertFails(updateDoc(doc(db, `patients/${patientId}/visits/v1`), { score: 3 }));
    await assertFails(deleteDoc(doc(db, `patients/${patientId}/visits/v1`)));
    await assertFails(updateDoc(doc(db, `patients/${patientId}`), { tmsEndDate: "2026-10-02" }));
    await assertFails(updateDoc(doc(db, `patients/${patientId}`), { flagLevel: "green", flagReasons: [] }));
    await assertFails(updateDoc(doc(db, samplePath(patientId, "flags")), { clearedAtMillis: 1_700_000_500_000 }));
  }

  /** Every Clinician read of the Patient succeeds. */
  async function clinicianReads(patientId: string) {
    const db = asClinician(env, CLINICIAN);
    for (const path of readPaths(patientId)) await assertSucceeds(getDoc(doc(db, path)));
    for (const sub of SUBCOLLECTIONS) await assertSucceeds(getDocs(dashboardQuery(db, patientId, sub)));
  }

  async function listedIds() {
    const snap = await assertSucceeds(getDocs(dashboardList(asClinician(env, CLINICIAN), CLINICIAN)));
    return snap.docs.map((d) => d.id).sort();
  }

  it("undecided: a new Patient is hidden from the Clinician until they choose", async () => {
    const carol = asPatient(env, "carol");
    await assertSucceeds(setDoc(doc(carol, "patients/carol"), newPatientDoc("Live patient", CLINICIAN)));
    await env.withSecurityRulesDisabled(async (ctx) => {
      for (const sub of SUBCOLLECTIONS) await setDoc(doc(ctx.firestore(), samplePath("carol", sub)), SAMPLES[sub].data);
    });

    await clinicianLocksOut("carol");
    expect(await listedIds()).toEqual([ALICE]);
  });

  it("declined: the Clinician reads nothing and writes nothing, and the Patient is off the list", async () => {
    await choose(ALICE, "declined", SHARED_AT + 1);

    await clinicianLocksOut(ALICE);
    expect(await listedIds()).toEqual([]);
  });

  it("granted: the Clinician reads the record and every collection, and the Patient is on the list", async () => {
    const carol = asPatient(env, "carol");
    await assertSucceeds(setDoc(doc(carol, "patients/carol"), newPatientDoc("Live patient", CLINICIAN)));
    await choose("carol", "granted", SHARED_AT + 1);
    await env.withSecurityRulesDisabled(async (ctx) => {
      for (const sub of SUBCOLLECTIONS) await setDoc(doc(ctx.firestore(), samplePath("carol", sub)), SAMPLES[sub].data);
    });

    await clinicianReads("carol");
    expect(await listedIds()).toEqual([ALICE, "carol"]);
  });

  it("withdrawn, then granted again: access stops at once and returns only when the Patient shares again", async () => {
    await clinicianReads(ALICE);

    await choose(ALICE, "declined", SHARED_AT + 1);
    await clinicianLocksOut(ALICE);

    await choose(ALICE, "granted", SHARED_AT + 2);
    await clinicianReads(ALICE);
    await assertSucceeds(setDoc(doc(asClinician(env, CLINICIAN), `patients/${ALICE}/visits/v2`), visit));
  });

  it("the list query without the sharing filter is rejected, so the dashboard cannot over-ask", async () => {
    const db = asClinician(env, CLINICIAN);
    await assertFails(getDocs(query(collection(db, "patients"), where("clinicianEmail", "==", CLINICIAN))));
    await assertFails(
      getDocs(query(collection(db, "patients"), where("clinicianEmail", "==", CLINICIAN), where("sharingConsent", "==", "declined"))),
    );
  });

  it("a change of sharing is a decision with its time; nothing moves a Patient back to undecided", async () => {
    const ref = doc(asPatient(env, ALICE), `patients/${ALICE}`);
    await assertFails(updateDoc(ref, { sharingConsent: "undecided", sharingChangedAtMillis: SHARED_AT + 1 }));
    await assertFails(updateDoc(ref, { sharingConsent: "declined" }));
    await assertFails(updateDoc(ref, { sharingConsent: "declined", sharingChangedAtMillis: "now" }));
    await assertSucceeds(updateDoc(ref, { sharingConsent: "declined", sharingChangedAtMillis: SHARED_AT + 1 }));
  });

  it("only the Patient changes sharing: not the Clinician, another Patient or a signed-out user", async () => {
    const change = { sharingConsent: "granted", sharingChangedAtMillis: SHARED_AT + 2 };
    await choose(ALICE, "declined", SHARED_AT + 1);
    for (const db of [asClinician(env, CLINICIAN), asPatient(env, BOB), signedOut(env)]) {
      await assertFails(updateDoc(doc(db, `patients/${ALICE}`), change));
      await assertFails(setDoc(doc(db, `patients/${ALICE}/consents/sharing`), { subject: "sharing", granted: true, changedAtMillis: 1 }));
    }
  });

  it("the Patient keeps full use of their own records while not sharing", async () => {
    await choose(ALICE, "declined", SHARED_AT + 1);
    const db = asPatient(env, ALICE);
    for (const path of readPaths(ALICE)) await assertSucceeds(getDoc(doc(db, path)));
    for (const sub of PATIENT_WRITABLE) for (const write of await writes(db, ALICE, sub, false)) await assertSucceeds(write());
    await assertSucceeds(setDoc(doc(db, `patients/${ALICE}/flags/f2`), { ...crisisFlag, sharedWithClinician: false }));
  });
});

describe("On a flag the Clinician can set only the cleared time, and can reset the Patient's level and reasons", () => {
  it("clears a flag and resets the Patient to green in one batch, as 'Clear after follow-up' does", async () => {
    const db = asClinician(env, CLINICIAN);
    const batch = writeBatch(db);
    batch.update(doc(db, samplePath(ALICE, "flags")), { clearedAtMillis: 1_700_000_500_000 });
    batch.update(doc(db, `patients/${ALICE}`), { flagLevel: "green", flagReasons: [] });
    await assertSucceeds(batch.commit());
  });

  it("resets the level to the highest remaining uncleared flag", async () => {
    const ref = doc(asClinician(env, CLINICIAN), `patients/${ALICE}`);
    await assertSucceeds(updateDoc(ref, { flagLevel: "amber", flagReasons: [AMBER_REASON] }));
    await assertFails(updateDoc(ref, { flagLevel: "purple", flagReasons: [] }));
  });

  it("clinicianCanOnlyClearFlag: cannot change a flag's level, kind, reason or raised time", async () => {
    const ref = doc(asClinician(env, CLINICIAN), samplePath(ALICE, "flags"));
    await assertFails(updateDoc(ref, { level: "green" }));
    await assertFails(updateDoc(ref, { kind: "drift" }));
    await assertFails(updateDoc(ref, { reason: "Nothing to see." }));
    await assertFails(updateDoc(ref, { raisedAtMillis: 1 }));
    await assertFails(updateDoc(ref, { clearedAtMillis: 1_700_000_500_000, level: "green" }));
    await assertFails(updateDoc(ref, { clearedAtMillis: "now" }));
  });

  it("cannot create or delete a flag", async () => {
    const db = asClinician(env, CLINICIAN);
    await assertFails(setDoc(doc(db, `patients/${ALICE}/flags/f2`), crisisFlag));
    await assertFails(deleteDoc(doc(db, samplePath(ALICE, "flags"))));
  });
});

describe("Re-consent shares future records only: the Clinician reads only what was saved while sharing", () => {
  /** The Patient records their choice the way the app does: the record and `consents/sharing` together. */
  async function choose(patientId: string, choice: "granted" | "declined", atMillis: number) {
    const db = asPatient(env, patientId);
    const batch = writeBatch(db);
    batch.update(doc(db, `patients/${patientId}`), { sharingConsent: choice, sharingChangedAtMillis: atMillis });
    batch.set(doc(db, `patients/${patientId}/consents/sharing`), { subject: "sharing", granted: choice === "granted", changedAtMillis: atMillis });
    await assertSucceeds(batch.commit());
  }

  /** The ids the dashboard's query returns for one collection. */
  async function shownIds(patientId: string, sub: Subcollection) {
    const snap = await assertSucceeds(getDocs(dashboardQuery(asClinician(env, CLINICIAN), patientId, sub)));
    return snap.docs.map((d) => d.id).sort();
  }

  it("the stamped collections are the ones the dashboard filters", () => {
    expect([...STAMPED_COLLECTIONS].sort()).toEqual([...STAMPED].sort());
  });

  it("the Clinician cannot get or query a document saved while the Patient was not sharing", async () => {
    const db = asClinician(env, CLINICIAN);
    for (const sub of STAMPED) {
      await assertFails(getDoc(doc(db, `patients/${ALICE}/${sub}/${OFF_PERIOD_ID}`)));
      // A missing document is refused the same way, so a refusal does not tell that one is hidden.
      await assertFails(getDoc(doc(db, `patients/${ALICE}/${sub}/no-such-doc`)));
      await assertSucceeds(getDoc(doc(db, samplePath(ALICE, sub))));
      // Without the sharing filter the whole query is rejected; with it, the off period is left out.
      await assertFails(getDocs(collection(db, `patients/${ALICE}/${sub}`)));
      await assertFails(getDocs(query(collection(db, `patients/${ALICE}/${sub}`), where("sharedWithClinician", "==", false))));
      expect(await shownIds(ALICE, sub)).toEqual([SAMPLES[sub].id]);
    }
  });

  it("the Patient still reads everything they saved, the time without sharing included", async () => {
    const db = asPatient(env, ALICE);
    for (const sub of STAMPED) {
      await assertSucceeds(getDoc(doc(db, `patients/${ALICE}/${sub}/${OFF_PERIOD_ID}`)));
      const snap = await assertSucceeds(getDocs(collection(db, `patients/${ALICE}/${sub}`)));
      expect(snap.docs.map((d) => d.id)).toContain(OFF_PERIOD_ID);
    }
  });

  it("after sharing again, the Clinician reads the earlier sharing period and what comes next, never the time in between", async () => {
    const patient = asPatient(env, ALICE);
    const writable = ["daily", "checkIns", "suggestions", "flags"] as const;

    await choose(ALICE, "declined", SHARED_AT + 1);
    for (const sub of writable) await assertSucceeds(setDoc(doc(patient, `patients/${ALICE}/${sub}/while-off`), appCreates(sub, false)));

    await choose(ALICE, "granted", SHARED_AT + 2);
    for (const sub of writable) await assertSucceeds(setDoc(doc(patient, `patients/${ALICE}/${sub}/after`), appCreates(sub, true)));

    const db = asClinician(env, CLINICIAN);
    for (const sub of writable) {
      await assertSucceeds(getDoc(doc(db, samplePath(ALICE, sub)))); // the earlier sharing period
      await assertSucceeds(getDoc(doc(db, `patients/${ALICE}/${sub}/after`)));
      await assertFails(getDoc(doc(db, `patients/${ALICE}/${sub}/while-off`)));
      await assertFails(getDoc(doc(db, `patients/${ALICE}/${sub}/${OFF_PERIOD_ID}`)));
      expect(await shownIds(ALICE, sub)).toEqual(["after", SAMPLES[sub].id].sort());
    }
    // Sharing again does not reach back: the Patient cannot restamp what was saved while off.
    for (const sub of writable) {
      await assertFails(updateDoc(doc(patient, `patients/${ALICE}/${sub}/while-off`), { sharedWithClinician: true }));
    }
  });

  it("a client cannot create a document with the wrong stamp, or without one", async () => {
    const alice = asPatient(env, ALICE);
    for (const sub of ["daily", "checkIns", "suggestions", "flags"] as const) {
      const { sharedWithClinician: _drop, ...unstamped } = appCreates(sub, true) as Record<string, unknown>;
      await assertFails(setDoc(doc(alice, `patients/${ALICE}/${sub}/new-doc`), appCreates(sub, false)));
      await assertFails(setDoc(doc(alice, `patients/${ALICE}/${sub}/new-doc`), unstamped));
      await assertFails(setDoc(doc(alice, `patients/${ALICE}/${sub}/new-doc`), { ...unstamped, sharedWithClinician: "yes" }));
      await assertSucceeds(setDoc(doc(alice, `patients/${ALICE}/${sub}/new-doc`), appCreates(sub, true)));
      // The demo shortcut too: this Demo Patient has not decided, so only false is right.
      const stranger = asPatient(env, STRANGER);
      await assertFails(setDoc(doc(stranger, `patients/${DEMO}/${sub}/new-doc`), appCreates(sub, true)));
      await assertSucceeds(setDoc(doc(stranger, `patients/${DEMO}/${sub}/new-doc`), appCreates(sub, false)));
    }
    await choose(ALICE, "declined", SHARED_AT + 1);
    for (const sub of ["daily", "checkIns", "suggestions", "flags"] as const) {
      await assertFails(setDoc(doc(alice, `patients/${ALICE}/${sub}/while-off`), appCreates(sub, true)));
      await assertSucceeds(setDoc(doc(alice, `patients/${ALICE}/${sub}/while-off`), appCreates(sub, false)));
    }
  });

  it("a client cannot change or drop the stamp", async () => {
    const alice = asPatient(env, ALICE);
    for (const sub of ["daily", "checkIns", "suggestions", "flags"] as const) {
      await assertFails(updateDoc(doc(alice, samplePath(ALICE, sub)), { sharedWithClinician: false }));
      await assertFails(updateDoc(doc(alice, `patients/${ALICE}/${sub}/${OFF_PERIOD_ID}`), { sharedWithClinician: true }));
      const { sharedWithClinician: _drop, ...unstamped } = SAMPLES[sub].data as Record<string, unknown>;
      await assertFails(setDoc(doc(alice, samplePath(ALICE, sub)), unstamped));
    }
    // A daily record rewritten later keeps its stamp, whatever sharing is now.
    await choose(ALICE, "declined", SHARED_AT + 1);
    await assertSucceeds(setDoc(doc(alice, samplePath(ALICE, "daily")), { ...SAMPLES.daily.data, composite: -0.2 }));
    await assertFails(setDoc(doc(alice, samplePath(ALICE, "daily")), { ...SAMPLES.daily.data, sharedWithClinician: false }));
  });

  it("the Clinician can clear only a flag they can see", async () => {
    const db = asClinician(env, CLINICIAN);
    await assertFails(updateDoc(doc(db, `patients/${ALICE}/flags/${OFF_PERIOD_ID}`), { clearedAtMillis: 1_700_000_500_000 }));
    await assertSucceeds(updateDoc(doc(db, samplePath(ALICE, "flags")), { clearedAtMillis: 1_700_000_500_000 }));
  });

  it("the dashboard's own queries succeed under the rules, including the Digest's newest-week query", async () => {
    const db = asClinician(env, CLINICIAN);
    for (const sub of SUBCOLLECTIONS) await assertSucceeds(getDocs(dashboardQuery(db, ALICE, sub)));
    const latest = await assertSucceeds(getDocs(dashboardQuery(db, ALICE, "digests", orderBy("isoWeek", "desc"), limit(1))));
    expect(latest.docs.map((d) => d.id)).toEqual([SAMPLES.digests.id]);
  });
});

describe("Ratings, Voice cues, the crisis marker, the assessment and the Outcome are recorded by functions, not edited by hand", () => {
  const RATINGS_AND_MARKERS: Record<string, unknown>[] = [
    { mood: 4 },
    { energy: 1 },
    { sleepQuality: 5 },
    { voiceCues: [{ label: "bright tone", intensity: 1, heard: "laughed" }] },
    { crisis: true },
    // The sample Check-in holds "assessed" and true, so each of these is a change.
    { assessment: "unassessed" },
    { assessment: "unavailable" },
    { previousTried: false },
  ];
  const OUTCOME: Record<string, unknown>[] = [
    { tried: true }, { tried: false }, { felt: 4 }, { objectiveChange: 0.4 }, { outcomeScore: 0.6 }, { outcomeCheckInId: "c1" },
  ];

  /** The Patient themselves, and anyone signed in through the demo shortcut, stamped as each shares now. */
  const actors = () => [
    { name: "the Patient", db: asPatient(env, ALICE), patientId: ALICE, shared: true },
    { name: "the demo shortcut", db: asPatient(env, STRANGER), patientId: DEMO, shared: false },
  ];

  it("the Patient creates a Check-in with its times only, and later sets its times", async () => {
    for (const { db, patientId, shared } of actors()) {
      const ref = doc(db, `patients/${patientId}/checkIns/c2`);
      await assertSucceeds(setDoc(ref, appCreates("checkIns", shared)));
      await assertSucceeds(updateDoc(ref, { endedAtMillis: 1_700_000_190_000 }));
      await assertSucceeds(updateDoc(ref, { startedAtMillis: 1_700_000_010_000, endedAtMillis: 1_700_000_200_000 }));
    }
  });

  it("the Patient cannot set ratings, Voice cues, the crisis marker or the assessment on a new Check-in", async () => {
    for (const { db, patientId, shared } of actors()) {
      for (const field of RATINGS_AND_MARKERS) {
        await assertFails(setDoc(doc(db, `patients/${patientId}/checkIns/c2`), { ...appCreates("checkIns", shared), ...field }));
      }
    }
  });

  it("the Patient cannot change the ratings, Voice cues, crisis marker or assessment Finish Check-in wrote", async () => {
    for (const { db, patientId } of actors()) {
      const ref = doc(db, samplePath(patientId, "checkIns"));
      for (const field of [...RATINGS_AND_MARKERS, { mood: null }, { voiceCues: [] }, { assessment: null }, { previousTried: null }, { id: "other" }]) {
        await assertFails(updateDoc(ref, field));
      }
      await assertFails(setDoc(ref, { ...checkIn, mood: 5 }));
    }
  });

  it("the Patient records a Suggestion and changes its status and booking", async () => {
    for (const { db, patientId, shared } of actors()) {
      const ref = doc(db, `patients/${patientId}/suggestions/s2`);
      await assertSucceeds(setDoc(ref, { ...appCreates("suggestions", shared), status: "proposed" }));
      await assertSucceeds(updateDoc(ref, { status: "accepted" }));
      await assertSucceeds(updateDoc(ref, { booked: true }));
      await assertSucceeds(updateDoc(doc(db, samplePath(patientId, "suggestions")), { status: "declined", booked: false }));
      // An app built before #21 writes no `outcomeCheckInId` at all.
      const { outcomeCheckInId: _left, ...older } = appCreates("suggestions", shared) as Record<string, unknown>;
      await assertSucceeds(setDoc(doc(db, `patients/${patientId}/suggestions/s3`), older));
    }
  });

  it("the Patient cannot set the Outcome on a new Suggestion", async () => {
    for (const { db, patientId, shared } of actors()) {
      for (const field of OUTCOME) {
        await assertFails(setDoc(doc(db, `patients/${patientId}/suggestions/s2`), { ...appCreates("suggestions", shared), ...field }));
      }
    }
  });

  it("the Patient cannot fill in or change the Outcome, or rewrite what was suggested", async () => {
    for (const { db, patientId } of actors()) {
      const ref = doc(db, samplePath(patientId, "suggestions"));
      for (const field of [...OUTCOME, { kind: "music" }, { details: "Something else" }, { suggestedAtMillis: 1 }]) {
        await assertFails(updateDoc(ref, field));
      }
      await assertFails(setDoc(ref, { ...suggestion, tried: true, felt: 5 }));
    }
  });

  it("the Clinician still writes neither Check-ins nor Suggestions", async () => {
    const db = asClinician(env, CLINICIAN);
    await assertFails(setDoc(doc(db, `patients/${ALICE}/checkIns/c2`), appCreates("checkIns", true)));
    await assertFails(updateDoc(doc(db, samplePath(ALICE, "checkIns")), { mood: 1 }));
    await assertFails(updateDoc(doc(db, samplePath(ALICE, "checkIns")), { endedAtMillis: 1 }));
    await assertFails(setDoc(doc(db, `patients/${ALICE}/suggestions/s2`), appCreates("suggestions", true)));
    await assertFails(updateDoc(doc(db, samplePath(ALICE, "suggestions")), { status: "declined" }));
    await assertFails(updateDoc(doc(db, samplePath(ALICE, "suggestions")), { tried: true, outcomeScore: 0.5 }));
  });
});

describe("Any verified account can read and write a Patient marked synthetic", () => {
  it("anyVerifiedAccountCanActAsSyntheticPatient: reads the record and every collection", async () => {
    for (const db of [asPatient(env, STRANGER), asPatient(env, ALICE), asClinician(env, OTHER_CLINICIAN)]) {
      for (const path of readPaths(DEMO)) await assertSucceeds(getDoc(doc(db, path)));
      await assertSucceeds(getDocs(query(collection(db, "patients"), where("synthetic", "==", true))));
    }
  });

  it("writes what the Patient writes: the phone's fields and the Patient's collections", async () => {
    // This Demo Patient has not decided on sharing, so what is saved now is stamped false.
    const db = asPatient(env, STRANGER);
    await assertSucceeds(updateDoc(doc(db, `patients/${DEMO}`), { lastSeenAtMillis: 1_700_000_400_000 }));
    for (const sub of PATIENT_WRITABLE) for (const write of await writes(db, DEMO, sub, false)) await assertSucceeds(write());
    await assertSucceeds(setDoc(doc(db, `patients/${DEMO}/flags/f2`), { ...crisisFlag, sharedWithClinician: false }));
  });

  it("cannot write Summaries, Visits or Digests through the demo shortcut", async () => {
    const db = asPatient(env, STRANGER);
    for (const sub of PATIENT_READ_ONLY) for (const write of await writes(db, DEMO, sub)) await assertFails(write());
  });

  it("cannot unmark the Patient as synthetic or move them to another Clinician", async () => {
    const ref = doc(asPatient(env, STRANGER), `patients/${DEMO}`);
    await assertFails(updateDoc(ref, { synthetic: false }));
    await assertFails(updateDoc(ref, { clinicianEmail: OTHER_CLINICIAN }));
    await assertFails(deleteDoc(ref));
  });

  it("cannot mark a record synthetic to share it", async () => {
    const db = asPatient(env, STRANGER);
    await assertFails(setDoc(doc(db, `patients/${STRANGER}`), { ...newPatientDoc("Me", CLINICIAN), synthetic: true }));
  });
});

describe("The mail collection is not writable or readable by any client", () => {
  it("no Patient, Clinician or signed-in user reads or writes mail", async () => {
    for (const db of [asPatient(env, ALICE), asClinician(env, CLINICIAN), asPatient(env, STRANGER), signedOut(env)]) {
      await assertFails(getDoc(doc(db, "mail/m1")));
      await assertFails(getDocs(collection(db, "mail")));
      await assertFails(setDoc(doc(db, "mail/m2"), mail));
      await assertFails(updateDoc(doc(db, "mail/m1"), { to: "attacker@example.com" }));
      await assertFails(deleteDoc(doc(db, "mail/m1")));
    }
  });
});

describe("The patientLimits collection is not writable or readable by any client", () => {
  it("no Patient (their own included), Clinician or signed-in user reads or resets the caps", async () => {
    for (const db of [asPatient(env, ALICE), asClinician(env, CLINICIAN), asPatient(env, STRANGER), signedOut(env)]) {
      await assertFails(getDoc(doc(db, `patientLimits/${ALICE}`)));
      await assertFails(setDoc(doc(db, `patientLimits/${ALICE}`), { checkInStarts: [], redFlagEmailsAtMillis: [] }));
      await assertFails(deleteDoc(doc(db, `patientLimits/${ALICE}`)));
    }
  });
});

describe("The clinicians allowlist is not readable or writable by any client", () => {
  it("no Patient, Clinician, signed-in or signed-out user reads, lists or writes it", async () => {
    const path = `clinicians/${CLINICIAN}`;
    for (const db of [asPatient(env, ALICE), asClinician(env, CLINICIAN), asPatient(env, STRANGER), signedOut(env)]) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(getDocs(collection(db, "clinicians")));
      await assertFails(setDoc(doc(db, path), allowlisted(CLINICIAN)));
      await assertFails(setDoc(doc(db, "clinicians/attacker@example.com"), allowlisted("attacker@example.com")));
      await assertFails(updateDoc(doc(db, path), { email: "attacker@example.com" }));
      await assertFails(deleteDoc(doc(db, path)));
    }
  });

  it("a Clinician cannot add themselves and then link a new Patient to themselves", async () => {
    const intruder = "intruder@example.com";
    await assertFails(setDoc(doc(asClinician(env, intruder), "clinicians", intruder), allowlisted(intruder)));
    await assertFails(setDoc(doc(asPatient(env, "carol"), "patients/carol"), newPatientDoc("Live patient", intruder)));
  });
});

describe("Signed-out users read nothing", () => {
  it("signedOutReadsNothing: no record, collection, list or Demo Patient", async () => {
    const db = signedOut(env);
    for (const id of [ALICE, DEMO]) {
      for (const path of readPaths(id)) await assertFails(getDoc(doc(db, path)));
    }
    await assertFails(getDocs(collection(db, "patients")));
    await assertFails(getDocs(query(collection(db, "patients"), where("synthetic", "==", true))));
    await assertFails(getDocs(query(collection(db, "patients"), where("clinicianEmail", "==", CLINICIAN))));
  });

  it("and writes nothing", async () => {
    const db = signedOut(env);
    await assertFails(setDoc(doc(db, "patients/nobody"), newPatientDoc("Nobody", CLINICIAN)));
    await assertFails(updateDoc(doc(db, `patients/${DEMO}`), { lastSeenAtMillis: 1 }));
    for (const sub of SUBCOLLECTIONS) for (const write of await writes(db, DEMO, sub)) await assertFails(write());
  });
});

describe("Everything outside the data contract is denied", () => {
  it("an unknown collection, top-level or under a Patient", async () => {
    const db = asPatient(env, ALICE);
    await assertFails(setDoc(doc(db, `patients/${ALICE}/notes/n1`), { text: "hello" }));
    await assertFails(getDoc(doc(db, `patients/${ALICE}/notes/n1`)));
  });
});

describe("Patients sign in with their own account (ADR 0010)", () => {
  const carol = () => newPatientDoc("Live patient", CLINICIAN);

  it("an anonymous user cannot create a Patient record", async () => {
    const db = asAnonymousPatient(env, "carol");
    await assertSucceeds(getDoc(doc(db, "patients/carol"))); // the app's check that it exists still works
    await assertFails(setDoc(doc(db, "patients/carol"), carol()));
  });

  it("an email and password account cannot create one before the email is verified", async () => {
    await assertFails(setDoc(doc(asUnverifiedPatient(env, "carol"), "patients/carol"), carol()));
  });

  it("a verified email and password account and a Google account can", async () => {
    await assertSucceeds(setDoc(doc(asPatient(env, "carol"), "patients/carol"), carol()));
    await assertSucceeds(setDoc(doc(asGooglePatient(env, "dave"), "patients/dave"), carol()));
  });

  it("a record made while the account was anonymous stays usable by its owner: reads, the phone's fields and every writable collection", async () => {
    // Created before ADR 0010, under the old rules; here with the Admin SDK.
    const created = () =>
      env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), "patients/early"), newPatientDoc("Early patient", CLINICIAN));
        for (const sub of SUBCOLLECTIONS) await setDoc(doc(ctx.firestore(), samplePath("early", sub)), SAMPLES[sub].data);
      });
    // Still anonymous, and later upgraded with linkWithCredential but not yet verified: same uid, same record.
    for (const db of [asAnonymousPatient(env, "early"), asUnverifiedPatient(env, "early")]) {
      await created();
      await assertSucceeds(getDoc(doc(db, "patients/early")));
      await assertSucceeds(updateDoc(doc(db, "patients/early"), { lastSeenAtMillis: 1_700_000_400_000, quietHoursStart: 22 }));
      for (const sub of PATIENT_WRITABLE) for (const write of await writes(db, "early", sub, false)) await assertSucceeds(write());
      await assertSucceeds(getDocs(collection(db, "patients/early/daily")));
    }
    // Their sharing choice still saves, and their Clinician then reads them as before.
    const atMillis = 1_700_000_500_000;
    await assertSucceeds(updateDoc(doc(asAnonymousPatient(env, "early"), "patients/early"), { sharingConsent: "granted", sharingChangedAtMillis: atMillis }));
    await assertSucceeds(getDoc(doc(asClinician(env, CLINICIAN), "patients/early")));
  });

  it("an anonymous account still cannot read or write another Patient", async () => {
    const db = asAnonymousPatient(env, "early");
    for (const path of readPaths(ALICE)) await assertFails(getDoc(doc(db, path)));
    await assertFails(updateDoc(doc(db, `patients/${ALICE}`), { lastSeenAtMillis: 1 }));
  });

  it("an anonymous or unverified account cannot use the demo shortcut", async () => {
    for (const db of [asAnonymousPatient(env, STRANGER), asUnverifiedPatient(env, STRANGER)]) {
      for (const path of readPaths(DEMO)) await assertFails(getDoc(doc(db, path)));
      await assertFails(getDocs(query(collection(db, "patients"), where("synthetic", "==", true))));
      await assertFails(updateDoc(doc(db, `patients/${DEMO}`), { lastSeenAtMillis: 1 }));
      for (const write of await writes(db, DEMO, "daily", false)) await assertFails(write());
    }
    await assertSucceeds(getDoc(doc(asGooglePatient(env, STRANGER), `patients/${DEMO}`)));
  });
});

describe("Only an account with the Clinician claim and a verified email reads as the Clinician", () => {
  it("a Patient whose verified email matches clinicianEmail, but without the claim, reads and writes nothing as the Clinician", async () => {
    const db = asAccountWithoutClaim(env, CLINICIAN);
    for (const path of readPaths(ALICE)) await assertFails(getDoc(doc(db, path)));
    await assertFails(getDocs(dashboardList(db, CLINICIAN)));
    await assertFails(setDoc(doc(db, `patients/${ALICE}/visits/v2`), visit));
    await assertFails(updateDoc(doc(db, `patients/${ALICE}`), { tmsEndDate: "2026-10-01" }));
    await assertFails(updateDoc(doc(db, samplePath(ALICE, "flags")), { clearedAtMillis: 1_700_000_500_000 }));
  });

  it("a Patient signed in with Google under the Clinician's email cannot read the Clinician's other Patients", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "patients/erin"), { ...newPatientDoc("Erin", CLINICIAN), sharingConsent: "granted", sharingChangedAtMillis: SHARED_AT });
    });
    const db = env
      .authenticatedContext(ALICE, { email: CLINICIAN, email_verified: true, firebase: { sign_in_provider: "google.com" } })
      .firestore();
    await assertFails(getDocs(dashboardList(db, CLINICIAN)));
    await assertFails(getDoc(doc(db, "patients/erin")));
    await assertSucceeds(getDoc(doc(db, `patients/${ALICE}`))); // her own record, as its owner
  });

  it("an account with the claim but an unverified email reads and writes nothing", async () => {
    const db = asUnverifiedClinician(env, CLINICIAN);
    for (const path of readPaths(ALICE)) await assertFails(getDoc(doc(db, path)));
    await assertFails(getDocs(dashboardList(db, CLINICIAN)));
    await assertFails(setDoc(doc(db, `patients/${ALICE}/visits/v2`), visit));
  });

  it("the claim with a verified email reads the dashboard's list and the Patient, as before", async () => {
    const db = asClinician(env, CLINICIAN);
    await assertSucceeds(getDocs(dashboardList(db, CLINICIAN)));
    for (const path of readPaths(ALICE)) await assertSucceeds(getDoc(doc(db, path)));
  });
});
