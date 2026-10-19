import type { ExecutionReport, TrackReport, TrackRole } from "./report.js";

export const TRACK_ROLES = [
  "service",
  "manual",
] as const satisfies readonly TrackRole[];

export function getTrackRole(track: Pick<TrackReport, "role">): TrackRole {
  return track.role ?? "service";
}

/**
 * Returns a report that contains only the tracks of the given role and their results
 */
export function filterReportByRole(
  report: ExecutionReport,
  role: TrackRole,
): ExecutionReport {
  const tracks = report.tracks.filter(t => getTrackRole(t) === role);
  const trackIds = new Set(tracks.map(t => t.id));
  return {
    ...report,
    tracks,
    results: report.results.filter(r => trackIds.has(r.trackId)),
  };
}

/**
 * Returns the roles that have at least one track in the report, in {@link TRACK_ROLES} order
 */
export function reportRoles(
  report: Pick<ExecutionReport, "tracks">,
): TrackRole[] {
  const present = new Set(report.tracks.map(getTrackRole));
  return TRACK_ROLES.filter(r => present.has(r));
}
