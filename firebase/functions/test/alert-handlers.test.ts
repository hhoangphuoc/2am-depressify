import { describe, expect, it } from "vitest";
import { mailIdFor } from "../src/alerts";
import { createAlertFunctions, redFlagAlertHandler } from "../src/alertFunctions";
import { LIMIT_WINDOW_MS, MAX_RED_FLAG_EMAILS_PER_HOUR } from "../src/limits";
import { REGION } from "../src/region";
import { newPatientDoc, type Flag } from "../src/types";
import { FakeAlertStore, PATIENT_ID } from "./fakes";

const FLAG_ID = "crisis-1";
const DASHBOARD = "https://dashboard.example.test";

function redFlag(overrides: Partial<Flag> = {}): Flag {
  return {
    level: "red",
    kind: "crisis",
    reason: "A crisis was raised in a Check-in.",
    raisedAtMillis: 1_700_000_000_000,
    clearedAtMillis: null,
    sharedWithClinician: true,
    ...overrides,
  };
}

const sharing = { ...newPatientDoc("Alex Example", "clinician@example.com"), sharingConsent: "granted" as const };

const NOW = 1_700_000_000_000;

function run(store: FakeAlertStore, flag: Partial<Flag> | undefined, flagId = FLAG_ID, nowMillis = NOW) {
  return redFlagAlertHandler({ patientId: PATIENT_ID, flagId, flag }, { store, dashboardUrl: DASHBOARD, clock: () => nowMillis });
}

describe("redFlagAlertHandler", () => {
  it("writes one email to mail/{mailIdFor(patient, flag)} for a red flag of a sharing Patient", async () => {
    const store = new FakeAlertStore({ [PATIENT_ID]: sharing });
    const outcome = await run(store, redFlag());
    expect(outcome).toEqual({ outcome: "sent", kind: "crisis" });
    expect([...store.mail.keys()]).toEqual([mailIdFor(PATIENT_ID, FLAG_ID)]);
    expect(store.mail.get(mailIdFor(PATIENT_ID, FLAG_ID))!.to).toBe("clinician@example.com");
  });

  it("writes nothing the second time the same flag's trigger runs", async () => {
    const store = new FakeAlertStore({ [PATIENT_ID]: sharing });
    await run(store, redFlag());
    expect(await run(store, redFlag())).toEqual({ outcome: "duplicate", kind: "crisis" });
    expect(store.mail.size).toBe(1);
    expect(store.creates).toBe(2);
  });

  it("stops emailing past the hourly cap for one Patient, and emails again an hour later", async () => {
    const store = new FakeAlertStore({ [PATIENT_ID]: sharing });
    for (let i = 0; i < MAX_RED_FLAG_EMAILS_PER_HOUR; i++) expect((await run(store, redFlag(), `flag-${i}`)).outcome).toBe("sent");
    expect(await run(store, redFlag(), "one-too-many")).toEqual({ outcome: "capped", kind: "crisis" });
    expect(store.mail.size).toBe(MAX_RED_FLAG_EMAILS_PER_HOUR);
    // A retried delivery of a flag already emailed is still a duplicate, not a second email.
    expect((await run(store, redFlag(), "flag-0")).outcome).toBe("duplicate");
    expect((await run(store, redFlag(), "an-hour-later", NOW + LIMIT_WINDOW_MS)).outcome).toBe("sent");
  });

  it("does not read the Patient record for an amber flag", async () => {
    const store = new FakeAlertStore({ [PATIENT_ID]: sharing });
    expect(await run(store, redFlag({ level: "amber", kind: "low_mood" }))).toEqual({ outcome: "skipped", skip: "not_red", kind: "low_mood" });
    expect(store.reads).toBe(0);
    expect(store.mail.size).toBe(0);
  });

  it("writes nothing for a Patient who is not sharing", async () => {
    const store = new FakeAlertStore({ [PATIENT_ID]: { ...sharing, sharingConsent: "declined" } });
    expect(await run(store, redFlag())).toEqual({ outcome: "skipped", skip: "not_sharing", kind: "crisis" });
    expect(store.mail.size).toBe(0);
  });

  it("writes nothing when the Patient record is gone", async () => {
    const store = new FakeAlertStore({});
    expect(await run(store, redFlag())).toEqual({ outcome: "skipped", skip: "no_patient", kind: "crisis" });
  });

  it("reports a kind outside the contract as other, so the log never carries a free-form value", async () => {
    const store = new FakeAlertStore({ [PATIENT_ID]: sharing });
    const outcome = await run(store, redFlag({ kind: "Something odd" as Flag["kind"] }));
    expect(outcome.kind).toBe("other");
  });

  it("lets a failed read or write throw, so the trigger is retried (the id keeps it to one email)", async () => {
    const reads = new FakeAlertStore({ [PATIENT_ID]: sharing });
    reads.failReads = true;
    await expect(run(reads, redFlag())).rejects.toThrow();
    const writes = new FakeAlertStore({ [PATIENT_ID]: sharing });
    writes.failWrites = true;
    await expect(run(writes, redFlag())).rejects.toThrow();
  });
});

describe("the redFlagAlert trigger", () => {
  const { redFlagAlert } = createAlertFunctions({ store: () => new FakeAlertStore({}), dashboardUrl: () => DASHBOARD });

  it("fires on flag creation in the database's region, and is retried (the mail id keeps it to one email)", () => {
    expect(redFlagAlert.__endpoint).toMatchObject({
      region: [REGION],
      eventTrigger: {
        eventType: "google.cloud.firestore.document.v1.created",
        eventFilterPathPatterns: { document: "patients/{patientId}/flags/{flagId}" },
        retry: true,
      },
    });
  });
});
