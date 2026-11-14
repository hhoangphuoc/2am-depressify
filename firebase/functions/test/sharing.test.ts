import { describe, expect, it } from "vitest";
import { isSharingActive } from "../src/sharing";
import { newPatientDoc, type PatientDoc } from "../src/types";

const patient = (sharingConsent: PatientDoc["sharingConsent"]): PatientDoc => ({
  ...newPatientDoc("Alice", "clinician@example.com"),
  sharingConsent,
});

describe("isSharingActive", () => {
  it("is true only while the Patient has granted sharing", () => {
    expect(isSharingActive(patient("granted"))).toBe(true);
  });

  it("is false for a Patient who declined or withdrew, and for one who has not decided", () => {
    expect(isSharingActive(patient("declined"))).toBe(false);
    expect(isSharingActive(patient("undecided"))).toBe(false);
    expect(isSharingActive(newPatientDoc("New", "clinician@example.com"))).toBe(false);
  });

  it("is false for a missing record or an unknown value, never assumed", () => {
    expect(isSharingActive(null)).toBe(false);
    expect(isSharingActive(undefined)).toBe(false);
    expect(isSharingActive({ sharingConsent: "maybe" as PatientDoc["sharingConsent"] })).toBe(false);
  });
});
