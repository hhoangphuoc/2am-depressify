import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The app links every new Patient to DemoConfig.CLINICIAN_EMAIL, and the security rules accept only
// the emails in linkableClinicians(). If the two drift apart, the app cannot create its Patient record.
const root = join(__dirname, "..", "..", "..");
const rules = readFileSync(join(root, "firebase", "firestore.rules"), "utf8");
const demoConfig = readFileSync(
  join(root, "shared", "src", "commonMain", "kotlin", "com", "twoam", "companion", "config", "DemoConfig.kt"),
  "utf8",
);

describe("the demo Clinician", () => {
  it("is a Clinician the rules let a new Patient link to", () => {
    const appEmail = demoConfig.match(/CLINICIAN_EMAIL: String = "([^"]+)"/)?.[1];
    const body = rules.match(/function linkableClinicians\(\) \{\s*return \[([^\]]*)\]/)?.[1];
    const ruleEmails = [...(body ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(appEmail).toBeDefined();
    expect(ruleEmails).toContain(appEmail);
  });
});
