import type { IOptimistExecutionSummary } from "@gearbox-protocol/cli-utils";
import type { ExecutionReport } from "@gearbox-protocol/liquidator-v2-config";
import { version } from "../version";
import { getFailedAccounts } from "./getFailedAccounts";

export function getSummary(report: ExecutionReport): IOptimistExecutionSummary {
  if (report.error) {
    return {
      version,
      startedAt: report.start.toISOString(),
      executionId: report.id,
      network: report.sdkState.network,
      status: "failed",
    };
  }

  const { nonWhitelisted } = getFailedAccounts(report);
  const state = report.sdkState.plugins.accounts;
  return {
    version,
    startedAt: report.start.toISOString(),
    executionId: report.id,
    network: report.sdkState.network,
    status: "success",
    discovered: state.loaded ? state.accounts.length : 0,
    failed: nonWhitelisted.length,
  };
}
