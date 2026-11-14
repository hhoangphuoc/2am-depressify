// The fictional Intake for the live demo Patient (docs/demo/intake-live-patient.md) stays usable:
// its expected highlights pass the same checks as a save, and carry no clinical labels.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INTAKE_MAX_WORDS, countWords, parseSaveRequest } from "../src/intake";

const DOC = readFileSync(join(__dirname, "../../../docs/demo/intake-live-patient.md"), "utf8");

function block(name: string): string {
  const match = new RegExp(`<!-- ${name}:start -->\\s*\`\`\`text\\n([\\s\\S]*?)\\n\`\`\`\\s*<!-- ${name}:end -->`).exec(DOC);
  if (!match) throw new Error(`no ${name} block in the demo Intake`);
  return match[1]!;
}

describe("demo Intake for the live Patient", () => {
  it("is marked fictional", () => {
    expect(DOC).toMatch(/Fictional\./);
    expect(block("report")).toMatch(/^FICTIONAL DEMO REPORT/);
    expect(block("highlights")).toMatch(/^Fictional demo data\./);
  });

  it("has highlights the save accepts, within 120 words", () => {
    const highlights = block("highlights");
    expect(countWords(highlights)).toBeLessThanOrEqual(INTAKE_MAX_WORDS);
    expect(parseSaveRequest({ patientId: "live", highlights }).highlights).toBe(highlights);
  });

  it("keeps clinical labels, medicine and scores out of the highlights", () => {
    expect(block("highlights")).not.toMatch(/diagnos|treatment|therapy|TMS|antidepressant|PHQ|dose|risk/i);
  });
});
