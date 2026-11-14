import { describe, expect, it } from "vitest";
import { healthStatus } from "../src/health";

describe("healthStatus", () => {
  it("reports ok with the time it was asked", () => {
    expect(healthStatus(1_763_000_000_000)).toEqual({ ok: true, atMillis: 1_763_000_000_000 });
  });
});
