import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REGION, SCHEDULER_REGION } from "../src/region";

// The dashboard is a browser module that cannot import the functions' source, so it keeps its own
// copy of the region. A callable in another region would not be found.
const dashboard = readFileSync(join(__dirname, "..", "..", "hosting", "js", "functions.js"), "utf8");

describe("the functions region", () => {
  it("is europe-north1, where the Firestore database is", () => {
    expect(REGION).toBe("europe-north1");
  });

  it("puts the scheduled Digest in an EU region Cloud Scheduler supports (it has no europe-north1)", () => {
    expect(SCHEDULER_REGION).toBe("europe-west1");
  });

  it("is the region the dashboard calls", () => {
    expect(dashboard.match(/FUNCTIONS_REGION = "([^"]+)"/)?.[1]).toBe(REGION);
  });
});
