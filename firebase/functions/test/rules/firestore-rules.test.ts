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
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clinicianListFilters } from "../../../hosting/js/lib/sharing.js";
import { newPatientDoc } from "../../src/types";
import {
  ALICE,
  AMBER_REASON,
  BOB,
  CLINICIAN,
  CLINICIAN_READ_ONLY,
  CRISIS_REASON,
  DEMO,
  OTHER_CLINICIAN,
  PATIENT_READ_ONLY,
  PATIENT_WRITABLE,
  SAMPLES,
  SHARED_AT,
  STRANGER,
  SUBCOLLECTIONS,
  asClinician,
  asPatient,
  crisisFlag,
  mail,
  samplePath,
  seed,
  signedOut,
  startEnv,
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

/** Create, update and delete on one collection of one Patient. */
async function writes(db: ReturnType<typeof signedOut>, patientId: string, sub: Subcollection) {
  const sample = SAMPLES[sub];
  return [
    () => setDoc(doc(db, `patients/${patientId}/${sub}/new-doc`), sample.data),
    () => setDoc(doc(db, samplePath(patientId, sub)), sample.data),
    () => deleteDoc(doc(db, samplePath(patientId, sub))),
  ];
}

describe("A Patient reads and writes their own record and its collections, but can only read Visits and Digests", () => {
  it("creates their own record the way the app does, linked to the demo Clinician, and reads it", async () => {
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
    for (const sub of SUBCOLLECTIONS) await assertSucceeds(getDocs(collection(db, `patients/${ALICE}/${sub}`)));
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
    for (const sub of SUBCOLLECTIONS) await assertFails(getDocs(collection(db, `patients/${patientId}/${sub}`)));
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
    for (const sub of SUBCOLLECTIONS) await assertSucceeds(getDocs(collection(db, `patients/${patientId}/${sub}`)));
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
    for (const sub of PATIENT_WRITABLE) for (const write of await writes(db, ALICE, sub)) await assertSucceeds(write());
    await assertSucceeds(setDoc(doc(db, `patients/${ALICE}/flags/f2`), crisisFlag));
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

describe("Any signed-in user can read and write a Patient marked synthetic", () => {
  it("anyoneSignedInCanActAsSyntheticPatient: reads the record and every collection", async () => {
    for (const db of [asPatient(env, STRANGER), asPatient(env, ALICE), asClinician(env, OTHER_CLINICIAN)]) {
      for (const path of readPaths(DEMO)) await assertSucceeds(getDoc(doc(db, path)));
      await assertSucceeds(getDocs(query(collection(db, "patients"), where("synthetic", "==", true))));
    }
  });

  it("writes what the Patient writes: the phone's fields and the Patient's collections", async () => {
    const db = asPatient(env, STRANGER);
    await assertSucceeds(updateDoc(doc(db, `patients/${DEMO}`), { lastSeenAtMillis: 1_700_000_400_000 }));
    for (const sub of PATIENT_WRITABLE) for (const write of await writes(db, DEMO, sub)) await assertSucceeds(write());
    await assertSucceeds(setDoc(doc(db, `patients/${DEMO}/flags/f2`), crisisFlag));
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
    await assertFails(setDoc(doc(db, "clinicians/c1"), { email: CLINICIAN }));
  });
});
