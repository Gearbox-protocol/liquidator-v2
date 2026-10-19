import type { OptimisticResult } from "./optimist.js";

export type LiquidationStatus = "success" | "warning" | "error";

export type StatusInput = Pick<OptimisticResult, "isError" | "error">;

export interface AccountStatusOptions {
  /**
   * Whitelisted accounts are always `success`
   */
  whitelisted?: boolean;
}

/**
 * Status of a single liquidation result.
 * An error that contains `warning:` means the track did not attempt the liquidation.
 */
export function resultStatus(result: StatusInput): LiquidationStatus {
  if (!result.isError) {
    return "success";
  }
  return result.error?.includes("warning:") ? "warning" : "error";
}

/**
 * Status of one credit account given its results across the tracks of one role.
 *
 * Returns the best status, not the worst: the account is `success` if any track
 * liquidated it, `error` if none did and at least one failed outright, and
 * `warning` otherwise (including when there are no results at all).
 */
export function accountStatus(
  results: readonly StatusInput[],
  options: AccountStatusOptions = {},
): LiquidationStatus {
  if (options.whitelisted) {
    return "success";
  }
  const statuses = new Set(results.map(resultStatus));
  if (statuses.has("success")) {
    return "success";
  }
  if (statuses.has("error")) {
    return "error";
  }
  return "warning";
}
