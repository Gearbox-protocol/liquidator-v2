import { describe, expect, it } from "vitest";
import { compareStatus, maxHealthStatusCode } from "./statusUtils.js";
import type { MonitoringStatus } from "./types.js";

describe("maxHealthStatusCode", () => {
  it("returns healthy for empty input", () => {
    expect(maxHealthStatusCode()).toBe("healthy");
  });

  it("ignores undefined", () => {
    expect(maxHealthStatusCode(undefined, "warning", undefined)).toBe(
      "warning",
    );
  });

  it("returns the most severe status", () => {
    expect(maxHealthStatusCode("healthy", "alert", "warning")).toBe("alert");
    expect(maxHealthStatusCode("alert", "not_responding")).toBe(
      "not_responding",
    );
  });

  it("does not escalate on not_deployed", () => {
    expect(maxHealthStatusCode("not_deployed")).toBe("healthy");
  });
});

describe("compareStatus", () => {
  it("sorts from the most severe when arguments are swapped", () => {
    const statuses: MonitoringStatus[] = [
      "healthy",
      "not_responding",
      "not_deployed",
      "alert",
      "warning",
    ];
    expect(statuses.sort((a, b) => compareStatus(b, a))).toEqual([
      "not_responding",
      "alert",
      "warning",
      "healthy",
      "not_deployed",
    ]);
  });
});
