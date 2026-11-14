// Smoke test of the walking skeleton's minimal rules. Needs the Firestore emulator:
//   cd firebase && firebase emulators:exec --only auth,firestore --project demo-twoam "npm --prefix functions run test:emulator"
// Issue #8 replaces this with the full rules suite.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { newPatientDoc } from "../../src/types";

const CLINICIAN = "clinician@example.com";
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-twoam",
    firestore: { rules: readFileSync(join(__dirname, "..", "..", "..", "firestore.rules"), "utf8") },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "patients/alice"), newPatientDoc("Alice", CLINICIAN));
    await setDoc(doc(ctx.firestore(), "patients/bob"), newPatientDoc("Bob", "other@example.com"));
    await setDoc(doc(ctx.firestore(), "patients/alice/checkIns/c1"), { id: "c1", startedAtMillis: 1 });
  });
});

const patient = (uid: string) => env.authenticatedContext(uid).firestore();
const clinician = (email: string) => env.authenticatedContext("clin-" + email, { email }).firestore();

describe("minimal rules", () => {
  it("a Patient creates and reads their own record", async () => {
    const db = patient("carol");
    await assertSucceeds(setDoc(doc(db, "patients/carol"), newPatientDoc("Live patient", CLINICIAN)));
    await assertSucceeds(getDoc(doc(db, "patients/carol")));
  });

  it("a Patient reads and writes their own collections", async () => {
    const db = patient("alice");
    await assertSucceeds(getDoc(doc(db, "patients/alice/checkIns/c1")));
    await assertSucceeds(setDoc(doc(db, "patients/alice/checkIns/c2"), { id: "c2", startedAtMillis: 2 }));
  });

  it("a Patient cannot read or write another Patient", async () => {
    const db = patient("alice");
    await assertFails(getDoc(doc(db, "patients/bob")));
    await assertFails(setDoc(doc(db, "patients/bob"), newPatientDoc("Bob", CLINICIAN)));
    await assertFails(getDoc(doc(patient("bob"), "patients/alice/checkIns/c1")));
  });

  it("the Clinician lists and reads Patients whose Clinician email is theirs", async () => {
    const db = clinician(CLINICIAN);
    await assertSucceeds(getDocs(query(collection(db, "patients"), where("clinicianEmail", "==", CLINICIAN))));
    await assertSucceeds(getDoc(doc(db, "patients/alice")));
  });

  it("the Clinician cannot read another Clinician's Patient or list everyone", async () => {
    const db = clinician(CLINICIAN);
    await assertFails(getDoc(doc(db, "patients/bob")));
    await assertFails(getDocs(collection(db, "patients")));
  });

  it("the Clinician cannot write a Patient record in the skeleton", async () => {
    await assertFails(setDoc(doc(clinician(CLINICIAN), "patients/alice"), newPatientDoc("Renamed", CLINICIAN)));
  });

  it("signed-out users read nothing", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "patients/alice")));
    await assertFails(getDocs(collection(db, "patients")));
    await assertFails(getDoc(doc(db, "patients/alice/checkIns/c1")));
  });
});
