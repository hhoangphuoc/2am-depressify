// Who the callables accept, by the kind of account (ADR 0010): the Patient's own verified account for
// Start and Finish Check-in (which spend Gemini credit), and for the Clinician's callables a verified
// account with the `role: "clinician"` claim. The emulator suites call the same checks through the
// Auth emulator's real tokens.
import { HttpsError } from "firebase-functions/v2/https";
import { describe, expect, it } from "vitest";
import { finishCheckInHandler, startCheckInHandler } from "../src/checkInFunctions";
import { assertClinicianOf, isVerifiedAccount, type CallerAuth } from "../src/clinician";
import { generateDigestHandler } from "../src/digestFunctions";
import { extractIntakeHandler, saveIntakeHandler } from "../src/intakeFunctions";
import { VERIFY_ACCOUNT_MESSAGE, assertActsAsPatient } from "../src/patientCaller";
import { newPatientDoc, type PatientDoc } from "../src/types";
import {
  CLINICIAN_EMAIL,
  FakeCheckInStore,
  FakeDigestStore,
  FakeLiveTokens,
  FakePatientStore,
  FakeTextModel,
  PATIENT_ID,
  anonymousPatient,
  clinician,
  clinicianToken,
  verifiedToken,
} from "./fakes";

const DEMO_ID = "demo-steady";
const live: Partial<PatientDoc> = { ...newPatientDoc("Live patient", CLINICIAN_EMAIL), sharingConsent: "granted" };
const demo: Partial<PatientDoc> = { ...live, synthetic: true };

const as = (uid: string, token: CallerAuth["token"]): CallerAuth => ({ uid, token });
const owner = {
  password: as(PATIENT_ID, verifiedToken("patient-1@example.com")),
  google: as(PATIENT_ID, { email: "patient-1@example.com", email_verified: true, firebase: { sign_in_provider: "google.com" } }),
  unverified: as(PATIENT_ID, { email: "patient-1@example.com", email_verified: false, firebase: { sign_in_provider: "password" } }),
  anonymous: anonymousPatient,
};
const stranger = {
  verified: as("stranger", verifiedToken("stranger@example.com")),
  anonymous: as("stranger", { firebase: { sign_in_provider: "anonymous" } }),
  unverified: as("stranger", { email: "stranger@example.com", email_verified: false, firebase: { sign_in_provider: "password" } }),
};

function thrown(run: () => void): HttpsError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpsError);
    return error as HttpsError;
  }
  throw new Error("expected the check to throw");
}

async function rejection(promise: Promise<unknown>): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpsError);
    return error as HttpsError;
  }
  throw new Error("expected the call to be rejected");
}

describe("isVerifiedAccount", () => {
  it("is a non-anonymous account whose email is verified", () => {
    expect(isVerifiedAccount(owner.password)).toBe(true);
    expect(isVerifiedAccount(owner.google)).toBe(true);
    expect(isVerifiedAccount(owner.unverified)).toBe(false);
    expect(isVerifiedAccount(owner.anonymous)).toBe(false);
    expect(isVerifiedAccount(as("x", {}))).toBe(false); // no email_verified at all
    expect(isVerifiedAccount(as("x", { email_verified: true, firebase: { sign_in_provider: "anonymous" } }))).toBe(false);
  });
});

describe("assertActsAsPatient: the Patient's own verified account (Start and Finish Check-in)", () => {
  it("accepts the owner signed in with a verified email and password account or with Google", () => {
    expect(() => assertActsAsPatient(PATIENT_ID, live, owner.password)).not.toThrow();
    expect(() => assertActsAsPatient(PATIENT_ID, live, owner.google)).not.toThrow();
  });

  it("tells an anonymous or unverified owner to verify, with failed-precondition", () => {
    for (const auth of [owner.anonymous, owner.unverified]) {
      const error = thrown(() => assertActsAsPatient(PATIENT_ID, live, auth));
      expect(error.code).toBe("failed-precondition");
      expect(error.message).toBe(VERIFY_ACCOUNT_MESSAGE);
      expect(error.message).toBe("Verify your account to start a Check-in.");
    }
  });

  it("decides verification from the token alone, so it tells nothing about whether a Patient exists", () => {
    for (const patient of [live, demo, undefined]) {
      expect(thrown(() => assertActsAsPatient("any-id", patient, stranger.anonymous)).code).toBe("failed-precondition");
    }
  });

  it("the demo shortcut takes any verified account, never an anonymous or unverified one", () => {
    expect(() => assertActsAsPatient(DEMO_ID, demo, stranger.verified)).not.toThrow();
    expect(thrown(() => assertActsAsPatient(DEMO_ID, demo, stranger.anonymous)).code).toBe("failed-precondition");
    expect(thrown(() => assertActsAsPatient(DEMO_ID, demo, stranger.unverified)).code).toBe("failed-precondition");
  });

  it("refuses another verified account on a live Patient, and a missing Patient, with one message", () => {
    const other = thrown(() => assertActsAsPatient(PATIENT_ID, live, stranger.verified));
    const missing = thrown(() => assertActsAsPatient("nobody", undefined, as("nobody", verifiedToken("nobody@example.com"))));
    expect(other.code).toBe("permission-denied");
    expect(missing.code).toBe("permission-denied");
    expect(missing.message).toBe(other.message);
  });

  it("the Clinician is not the Patient: the claim gives no Patient access", () => {
    expect(thrown(() => assertActsAsPatient(PATIENT_ID, live, clinician)).code).toBe("permission-denied");
  });

  it("refuses a signed-out caller with unauthenticated", () => {
    expect(thrown(() => assertActsAsPatient(PATIENT_ID, live, undefined)).code).toBe("unauthenticated");
  });
});

describe("Start and Finish Check-in refuse an anonymous Patient before spending Gemini credit", () => {
  const BRIEF = "Fictional Brief: ask about the walk.";

  it("start mints no token and writes nothing for an anonymous or unverified owner", async () => {
    for (const auth of [owner.anonymous, owner.unverified]) {
      const store = new FakeCheckInStore({ [PATIENT_ID]: live });
      const tokens = new FakeLiveTokens();
      const error = await rejection(startCheckInHandler({ data: { patientId: PATIENT_ID, brief: BRIEF }, auth }, { store, liveTokens: tokens }));
      expect(error.code).toBe("failed-precondition");
      expect(error.message).toBe(VERIFY_ACCOUNT_MESSAGE);
      expect(tokens.requests).toHaveLength(0);
      expect(store.writes).toHaveLength(0);
    }
  });

  it("start works once the same uid is verified (an anonymous account upgraded with linkWithCredential)", async () => {
    const store = new FakeCheckInStore({ [PATIENT_ID]: live });
    const result = await startCheckInHandler(
      { data: { patientId: PATIENT_ID, brief: BRIEF }, auth: owner.google },
      { store, liveTokens: new FakeLiveTokens(), newId: () => "c1" },
    );
    expect(result.checkInId).toBe("c1");
  });

  it("finish never calls the model or writes for an anonymous owner", async () => {
    const store = new FakeCheckInStore({ [PATIENT_ID]: live });
    await startCheckInHandler(
      { data: { patientId: PATIENT_ID, brief: BRIEF }, auth: owner.password },
      { store, liveTokens: new FakeLiveTokens(), newId: () => "c1" },
    );
    const writes = store.writes.length;
    const model = new FakeTextModel("{}");
    const draft = { turns: [{ speaker: "patient", text: "A fictional line." }] };
    const error = await rejection(finishCheckInHandler({ data: { patientId: PATIENT_ID, checkInId: "c1", draft }, auth: owner.anonymous }, { store, textModel: model }));
    expect(error.code).toBe("failed-precondition");
    expect(model.requests).toHaveLength(0);
    expect(store.writes).toHaveLength(writes);
  });
});

describe("assertClinicianOf: the claim, a verified email, the linked email and sharing", () => {
  it("accepts the Clinician's account as allow-clinician leaves it, by password or by Google", () => {
    expect(() => assertClinicianOf(live, clinician)).not.toThrow();
    const google = as("g", { ...clinicianToken(CLINICIAN_EMAIL), firebase: { sign_in_provider: "google.com" } });
    expect(() => assertClinicianOf(live, google)).not.toThrow();
  });

  it.each([
    ["a Patient's verified account with the Clinician's email but no claim", as(PATIENT_ID, verifiedToken(CLINICIAN_EMAIL))],
    ["the claim with an unverified email", as("c", { ...clinicianToken(CLINICIAN_EMAIL), email_verified: false })],
    ["the claim on an account with no email_verified", as("c", { email: CLINICIAN_EMAIL, role: "clinician", firebase: { sign_in_provider: "password" } })],
    ["another role", as("c", { ...clinicianToken(CLINICIAN_EMAIL), role: "admin" })],
    ["the claim on an anonymous account", as("c", { ...clinicianToken(CLINICIAN_EMAIL), firebase: { sign_in_provider: "anonymous" } })],
    ["the claim with another email", as("c", clinicianToken("other-clinician@example.com"))],
  ] as const)("refuses %s, with the same message as a missing Patient", (_name, auth) => {
    const error = thrown(() => assertClinicianOf(live, auth));
    expect(error.code).toBe("permission-denied");
    expect(error.message).toBe(thrown(() => assertClinicianOf(undefined, clinician)).message);
  });

  it("still requires sharing", () => {
    expect(thrown(() => assertClinicianOf({ ...live, sharingConsent: "declined" }, clinician)).code).toBe("permission-denied");
  });

  it("the Intake and Digest callables refuse an account without the claim before calling the model", async () => {
    const patient = as(PATIENT_ID, verifiedToken(CLINICIAN_EMAIL));
    const model = new FakeTextModel("- Highlights.");
    const patients = new FakePatientStore();
    const report = "A fictional report.";
    expect((await rejection(extractIntakeHandler({ data: { patientId: PATIENT_ID, reportText: report }, auth: patient }, { patients, textModel: model }))).code).toBe("permission-denied");
    expect((await rejection(saveIntakeHandler({ data: { patientId: PATIENT_ID, highlights: "- Highlights." }, auth: patient }, { patients }))).code).toBe("permission-denied");
    const store = new FakeDigestStore({ [PATIENT_ID]: { patient: live as PatientDoc } });
    expect((await rejection(generateDigestHandler({ data: { patientId: PATIENT_ID }, auth: patient }, { store, textModel: model, nowMillis: () => Date.now() }))).code).toBe("permission-denied");
    expect(model.requests).toHaveLength(0);
    expect(patients.writes).toHaveLength(0);
    expect(store.writes).toHaveLength(0);
  });
});
