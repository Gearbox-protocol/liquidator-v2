import type { MonitoringStatus } from "./types.js";

/**
 * Severity rank of each {@link MonitoringStatus}, higher is worse.
 *
 * `not_deployed` ranks below `healthy`, so it never escalates an aggregated status.
 */
export const MONITORING_STATUS_ORDER: Record<MonitoringStatus, number> = {
  not_deployed: 0,
  healthy: 1,
  warning: 2,
  alert: 3,
  not_responding: 4,
};

/**
 * Returns the most severe of the given statuses, according to {@link MONITORING_STATUS_ORDER}.
 *
 * Typically used to aggregate statuses of individual checks into the status of a service,
 * or statuses of services into the status of a network.
 *
 * @param codes - Statuses to aggregate. `undefined` entries (checks that are not applicable) are ignored.
 * @returns The most severe status, or `"healthy"` when no status is more severe than it
 * (including empty input and input that consists only of `undefined` and `not_deployed`).
 */
export function maxHealthStatusCode<S extends MonitoringStatus>(
  ...codes: Array<S | undefined>
): S | "healthy" {
  let status: S | "healthy" = "healthy";
  for (const code of codes) {
    if (!code) {
      continue;
    }
    if (MONITORING_STATUS_ORDER[code] > MONITORING_STATUS_ORDER[status]) {
      status = code;
    }
  }
  return status;
}

/**
 * Comparator that orders statuses from the least to the most severe.
 *
 * Swap the arguments to sort the most severe first.
 *
 * @param a - First status
 * @param b - Second status
 * @returns Negative when `a` is less severe than `b`, positive when more severe, `0` when equal
 */
export function compareStatus(
  a: MonitoringStatus,
  b: MonitoringStatus,
): number {
  return MONITORING_STATUS_ORDER[a] - MONITORING_STATUS_ORDER[b];
}
