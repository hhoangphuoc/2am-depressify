import { describe, expect, it } from "vitest";
import { alertDecision, alertFor, dashboardLink, mailIdFor, resolveDashboardUrl, type AlertOptions } from "../src/alerts";
import { FLAG_KINDS, newPatientDoc, type Flag, type FlagKind, type PatientDoc } from "../src/types";

const RAISED = Date.UTC(2026, 10, 14, 19, 5); // 14 Nov 2026 21:05 in Helsinki
const OPTIONS: AlertOptions = { patientId: "patient-1", dashboardUrl: "https://dashboard.example.test" };

function flag(overrides: Partial<Flag> = {}): Flag {
  return {
    level: "red",
    kind: "crisis",
    reason: "A crisis was raised in a Check-in.",
    raisedAtMillis: RAISED,
    clearedAtMillis: null,
    sharedWithClinician: true,
    ...overrides,
  };
}

function patient(overrides: Partial<PatientDoc> = {}): PatientDoc {
  return { ...newPatientDoc("Alex Example", "clinician@example.com"), sharingConsent: "granted", ...overrides };
}

describe("alertFor: which flags email the Clinician", () => {
  it("emails for a red, uncleared, shared flag of a sharing Patient", () => {
    const mail = alertFor(flag(), patient(), OPTIONS);
    expect(mail).not.toBeNull();
    expect(mail!.to).toBe("clinician@example.com");
  });

  it.each(["amber", "green"] as const)("sends nothing for a %s flag", (level) => {
    expect(alertFor(flag({ level, kind: "low_mood" }), patient(), OPTIONS)).toBeNull();
    expect(alertDecision(flag({ level }), patient(), OPTIONS)).toEqual({ skip: "not_red" });
  });

  it("sends nothing for a flag that is already cleared", () => {
    expect(alertDecision(flag({ clearedAtMillis: RAISED + 1 }), patient(), OPTIONS)).toEqual({ skip: "cleared" });
  });

  it("sends nothing for a flag stamped as raised while the Patient was not sharing", () => {
    expect(alertDecision(flag({ sharedWithClinician: false }), patient(), OPTIONS)).toEqual({ skip: "not_shared" });
  });

  it.each(["declined", "undecided"] as const)("sends nothing while the Patient's sharing Consent is %s", (sharingConsent) => {
    expect(alertDecision(flag(), patient({ sharingConsent }), OPTIONS)).toEqual({ skip: "not_sharing" });
  });

  it("sends nothing when the Patient record is missing", () => {
    expect(alertDecision(flag(), undefined, OPTIONS)).toEqual({ skip: "no_patient" });
  });

  it("sends nothing when the flag is missing or malformed", () => {
    expect(alertDecision(undefined, patient(), OPTIONS)).toEqual({ skip: "not_red" });
    // No stamp counts as not shared: only a flag stamped true is ever emailed.
    expect(alertDecision({ level: "red" }, patient(), OPTIONS)).toEqual({ skip: "not_shared" });
  });

  it.each(["", "   ", "not-an-address"])("sends nothing without a usable clinicianEmail (%j)", (clinicianEmail) => {
    expect(alertDecision(flag(), patient({ clinicianEmail }), OPTIONS)).toEqual({ skip: "no_clinician" });
  });

  it("sends nothing when clinicianEmail is absent", () => {
    const { clinicianEmail: _omit, ...rest } = patient();
    expect(alertDecision(flag(), rest, OPTIONS)).toEqual({ skip: "no_clinician" });
  });

  it("sends nothing for a Demo Patient: the seed recreates their invented red flags on every run", () => {
    expect(alertDecision(flag(), patient({ synthetic: true }), OPTIONS)).toEqual({ skip: "synthetic" });
  });

  it("checks the flag before the Patient, so an amber flag never needs the Patient record", () => {
    expect(alertDecision(flag({ level: "amber" }), undefined, OPTIONS)).toEqual({ skip: "not_red" });
  });

  it("emails for every red kind, not only crisis", () => {
    for (const kind of FLAG_KINDS) expect(alertFor(flag({ kind }), patient(), OPTIONS), kind).not.toBeNull();
  });
});

describe("alertFor: the email", () => {
  it("is the Trigger Email shape: to, message.subject, message.text and nothing else", () => {
    const mail = alertFor(flag(), patient(), OPTIONS)!;
    expect(Object.keys(mail).sort()).toEqual(["message", "to"]);
    expect(Object.keys(mail.message).sort()).toEqual(["subject", "text"]);
  });

  it("sends to the Patient's linked Clinician, in lower case and trimmed", () => {
    expect(alertFor(flag(), patient({ clinicianEmail: "  Clinician@Example.COM " }), OPTIONS)!.to).toBe("clinician@example.com");
  });

  it("marks a crisis apart from other reds in the subject", () => {
    const crisis = alertFor(flag({ kind: "crisis" }), patient(), OPTIONS)!.message.subject;
    const silent = alertFor(flag({ kind: "silent" }), patient(), OPTIONS)!.message.subject;
    const sleep = alertFor(flag({ kind: "sleep_collapse" }), patient(), OPTIONS)!.message.subject;
    expect(crisis).toBe("[CRISIS] Red flag for Alex Example: crisis in a Check-in");
    expect(silent).toBe("[RED] Red flag for Alex Example: quiet phone");
    expect(sleep).toBe("[RED] Red flag for Alex Example: sleep collapse");
    expect(silent).not.toMatch(/crisis/i);
    expect(sleep).not.toMatch(/crisis/i);
  });

  it("gives the display name, the reason as written, the time in Helsinki and a link to the Patient's page", () => {
    const text = alertFor(flag(), patient(), OPTIONS)!.message.text;
    expect(text).toContain("A red Attention flag was raised for Alex Example on 14 Nov 2026, 21:05 (Helsinki time).");
    expect(text).toContain("Reason: A crisis was raised in a Check-in.");
    expect(text).toContain("https://dashboard.example.test/#/patient/patient-1");
  });

  it("words each red kind plainly: crisis, quiet phone (not read as self-harm), sleep collapse, inactive", () => {
    const body = (kind: FlagKind) => alertFor(flag({ kind }), patient(), OPTIONS)!.message.text;
    expect(body("crisis")).toContain("Kind: crisis. It was raised from a Check-in.");
    expect(body("silent")).toContain("Kind: quiet phone. The phone has not been in touch for 24 hours. A quiet phone is not by itself a sign of self-harm.");
    expect(body("sleep_collapse")).toContain("Kind: sleep collapse. It comes from the phone's sleep data compared with the Patient's own Baseline.");
    expect(body("inactive")).toContain("Kind: inactive. It comes from the phone's step and screen data.");
    const quiet = alertFor(flag({ kind: "silent", reason: "The phone has been quiet for over a day." }), patient(), OPTIONS)!.message.text;
    expect(quiet).not.toMatch(/crisis/i);
  });

  it("uses the companion's words: never diagnosis, treatment, therapy, risk or a score (ADR 0001, ADR 0009)", () => {
    for (const kind of FLAG_KINDS) {
      const { subject, text } = alertFor(flag({ kind, reason: "Sleep was far below usual." }), patient(), OPTIONS)!.message;
      for (const word of [/diagnos/i, /treatment/i, /therap/i, /\brisk\b/i, /score/i, /\d+(\.\d+)?\s*%/]) {
        expect(subject, `${kind} subject`).not.toMatch(word);
        expect(text, `${kind} body`).not.toMatch(word);
      }
    }
  });

  it("carries only the flag's reason: nothing else from the Patient record reaches the email", () => {
    const p = patient({ intakeHighlights: "Intake-Marker-4471", flagReasons: ["Older-Reason-Marker-9921"] });
    const { subject, text } = alertFor(flag(), p, OPTIONS)!.message;
    for (const marker of ["Intake-Marker-4471", "Older-Reason-Marker-9921"]) {
      expect(subject).not.toContain(marker);
      expect(text).not.toContain(marker);
    }
  });

  it("puts the name and the reason on one line each, so neither can add headers or lines", () => {
    const p = patient({ displayName: "Alex\r\nBcc: someone@example.com" });
    const mail = alertFor(flag({ reason: "Line one.\n\nLine two." }), p, OPTIONS)!;
    expect(mail.message.subject).toBe("[CRISIS] Red flag for Alex Bcc: someone@example.com: crisis in a Check-in");
    expect(mail.message.subject).not.toMatch(/[\r\n]/);
    expect(mail.message.text).toContain("Reason: Line one. Line two.");
  });

  it("caps a long reason and a long name", () => {
    const mail = alertFor(flag({ reason: "x".repeat(2000) }), patient({ displayName: "n".repeat(500) }), OPTIONS)!;
    expect(mail.message.subject.length).toBeLessThan(160);
    const reasonLine = mail.message.text.split("\n").find((l) => l.startsWith("Reason: "))!;
    expect(reasonLine.length).toBeLessThanOrEqual("Reason: ".length + 300);
    expect(reasonLine.endsWith("…")).toBe(true);
  });

  it("names the Patient generically when the display name is blank", () => {
    expect(alertFor(flag(), patient({ displayName: "  " }), OPTIONS)!.message.subject).toBe("[CRISIS] Red flag for a Patient: crisis in a Check-in");
  });

  it("says the reason was not given when it is blank, rather than leaving the line empty", () => {
    expect(alertFor(flag({ reason: "" }), patient(), OPTIONS)!.message.text).toContain("Reason: not given. See the dashboard.");
  });

  it("is the same for the same flag and Patient (a retried trigger writes the same email)", () => {
    expect(alertFor(flag(), patient(), OPTIONS)).toEqual(alertFor(flag(), patient(), OPTIONS));
  });
});

describe("the mail document id", () => {
  it("is derived from the Patient and the flag, so a retried trigger cannot send twice", () => {
    expect(mailIdFor("patient-1", "crisis-2026-11-14")).toMatch(/^red-flag-[0-9a-f]{64}$/);
    expect(mailIdFor("patient-1", "a")).toBe(mailIdFor("patient-1", "a"));
    expect(mailIdFor("patient-1", "a")).not.toBe(mailIdFor("patient-1", "b"));
    expect(mailIdFor("patient-1", "a")).not.toBe(mailIdFor("patient-2", "a"));
  });

  it("cannot collide across Patients when ids contain the separator", () => {
    expect(mailIdFor("a-b", "c")).not.toBe(mailIdFor("a", "b-c"));
  });
});

describe("the dashboard link", () => {
  it("opens the Patient's page on the dashboard", () => {
    expect(dashboardLink("https://dashboard.example.test", "abc")).toBe("https://dashboard.example.test/#/patient/abc");
    expect(dashboardLink("https://dashboard.example.test/", "abc")).toBe("https://dashboard.example.test/#/patient/abc");
    expect(dashboardLink("https://dashboard.example.test", "a b/c")).toBe("https://dashboard.example.test/#/patient/a%20b%2Fc");
  });

  it("defaults to the project's Firebase Hosting site when DASHBOARD_URL is not set", () => {
    expect(resolveDashboardUrl("", "my-project")).toBe("https://my-project.web.app");
    expect(resolveDashboardUrl("  ", "my-project")).toBe("https://my-project.web.app");
    expect(resolveDashboardUrl("https://custom.example.test/", "my-project")).toBe("https://custom.example.test");
    expect(resolveDashboardUrl("", undefined)).toBe("");
  });

  it("leaves the link out when there is no dashboard URL at all", () => {
    const text = alertFor(flag(), patient(), { patientId: "patient-1", dashboardUrl: "" })!.message.text;
    expect(text).toContain("Open the Clinician dashboard to see the flag and clear it after follow-up.");
    expect(text).not.toContain("#/patient/");
  });
});
