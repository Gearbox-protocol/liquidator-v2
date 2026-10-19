import { describe, expect, it } from "vitest";

import type { OptimisticResult } from "./optimist.js";
import type { ExecutionReport, TrackReport } from "./report.js";
import { filterReportByRole, getTrackRole, reportRoles } from "./trackRoles.js";

function track(id: string, role?: TrackReport["role"]): TrackReport {
  return {
    id,
    name: id,
    start: new Date(0),
    end: new Date(0),
    version: "test",
    emergency: false,
    role,
  };
}

function result(trackId: string): OptimisticResult {
  return { trackId } as OptimisticResult;
}

function report(tracks: TrackReport[]): ExecutionReport {
  return {
    tracks,
    results: tracks.map(t => result(t.id)),
  } as ExecutionReport;
}

describe("getTrackRole", () => {
  it("defaults to service", () => {
    expect(getTrackRole(track("full"))).toBe("service");
  });

  it("returns the declared role", () => {
    expect(getTrackRole(track("wallet", "manual"))).toBe("manual");
  });
});

describe("filterReportByRole", () => {
  const r = report([
    track("full"),
    track("partial", "service"),
    track("wallet", "manual"),
  ]);

  it("keeps tracks and results of the service role", () => {
    const filtered = filterReportByRole(r, "service");
    expect(filtered.tracks.map(t => t.id)).toEqual(["full", "partial"]);
    expect(filtered.results.map(t => t.trackId)).toEqual(["full", "partial"]);
  });

  it("keeps tracks and results of the manual role", () => {
    const filtered = filterReportByRole(r, "manual");
    expect(filtered.tracks.map(t => t.id)).toEqual(["wallet"]);
    expect(filtered.results.map(t => t.trackId)).toEqual(["wallet"]);
  });
});

describe("reportRoles", () => {
  it("returns roles in canonical order", () => {
    expect(reportRoles(report([track("w", "manual"), track("f")]))).toEqual([
      "service",
      "manual",
    ]);
  });

  it("returns only present roles", () => {
    expect(reportRoles(report([track("w", "manual")]))).toEqual(["manual"]);
    expect(reportRoles(report([]))).toEqual([]);
  });
});
