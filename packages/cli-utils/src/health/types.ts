import type { ProviderStatus } from "@gearbox-protocol/sdk/dev";
import type { NetworkType } from "@gearbox-protocol/sdk/onchain";
import type { Address } from "viem";

/**
 * Status that a running service reports about itself or about one of its checks.
 *
 * - `healthy`: everything works as expected
 * - `warning`: degraded, but no action is required yet
 * - `alert`: requires attention
 */
export type HealthStatusCode = "healthy" | "warning" | "alert";

/**
 * Status of a service as seen by the monitoring lambda and the dashboard.
 *
 * Extends {@link HealthStatusCode} with states that a service cannot report about itself:
 *
 * - `not_deployed`: the service can be deployed, but is not
 * - `not_responding`: the service is deployed, but its health endpoint could not be reached
 */
export type MonitoringStatus =
  | "not_deployed"
  | HealthStatusCode
  | "not_responding";

/**
 * Value of a single health check together with its verdict.
 *
 * @typeParam T - Type of the checked value
 */
export interface HealthStatusValue<T> {
  /**
   * Checked value
   */
  value: T;
  /**
   * Verdict of the check, contributes to the status of the whole service
   */
  status: HealthStatusCode;
}

/**
 * Result of a check that runs over a collection of items, some of which can fail.
 */
export interface HealthFailureStats {
  /**
   * Number of checked items
   */
  total: number;
  /**
   * Number of items that failed the check
   */
  failed: number;
  /**
   * Verdict of the check, contributes to the status of the whole service
   */
  status: HealthStatusCode;
}

/**
 * Fields that every service health response has.
 */
export interface IBaseHealthResponse {
  /**
   * Aggregated status of the service, the most severe of statuses of all its checks
   */
  status: HealthStatusCode;
  /**
   * Time when the service process started, in unix seconds
   */
  startTime: number;
  /**
   * Version of the service
   */
  version: string;
  /**
   * Service family, groups services of the same kind in the dashboard (e.g. `liquidators`)
   */
  family: string;
  /**
   * Timestamp of the latest processed block (or the latest run), in unix seconds.
   *
   * Its status turns to `alert` when the value is older than the service's staleness threshold.
   */
  timestamp: HealthStatusValue<number>;
  /**
   * Whether the service runs in dry-run mode, i.e. does not send transactions.
   *
   * Its status is `warning` when dry-run mode is on. Absent for services that do not support dry-run mode.
   */
  dryRun?: HealthStatusValue<boolean>;
}

/**
 * Service health response without the fields that `HealthServer` (from `@gearbox-protocol/cli-utils/node`) fills in itself.
 *
 * @typeParam T - Full health response of the service
 */
export type HealthPayload<T extends IBaseHealthResponse = IBaseHealthResponse> =
  Omit<T, "startTime" | "version">;

/**
 * Health response of a service that runs Gearbox SDK on a single network.
 */
export interface ISDKHealthResponse extends IBaseHealthResponse {
  /**
   * Network that the service runs on
   */
  network: NetworkType;
  /**
   * Latest block processed by the SDK.
   *
   * Absent until the SDK is attached.
   */
  currentBlock?: bigint;
  /**
   * Market configurators that the SDK has loaded
   */
  marketsConfigurators?: Address[];
  /**
   * Pools that the SDK has loaded
   */
  pools?: Address[];
  /**
   * Credit managers that the SDK has loaded
   */
  creditManagers?: Address[];
  /**
   * Statuses of RPC providers of the revolver transport
   */
  providers?: ProviderStatus[];
}

/**
 * Fields of a service that sends transactions from its own wallet.
 */
export interface IWalletHealthResponse {
  /**
   * Address of the service wallet.
   *
   * Absent when the service has no wallet configured.
   */
  address?: Address;
  /**
   * Native token balance of the service wallet, in wei.
   *
   * Its status turns to `alert` when the balance is below the minimum required to send transactions.
   * Absent until the balance is checked for the first time, or when the check is disabled.
   */
  balance?: HealthStatusValue<bigint>;
}

/**
 * Health of a single network inside a {@link IMultichainHealthResponse}.
 */
export interface INetworkHealthResponse
  extends HealthPayload<ISDKHealthResponse> {}

/**
 * Health response of a service that runs on several networks within one process.
 *
 * Top-level fields describe the process as a whole, per-network details live in {@link IMultichainHealthResponse.networks}.
 */
export interface IMultichainHealthResponse extends IBaseHealthResponse {
  /**
   * Health of each network, the top-level status is the most severe of their statuses
   */
  networks: INetworkHealthResponse[];
}

/**
 * Liquidation strategy of a liquidator.
 */
export type LiquidationMode =
  | "full"
  | "partial"
  | "batch"
  | "deleverage"
  | "wallet";

/**
 * Status of a single deleverage bot.
 */
export interface IDeleverageBotStatus {
  /**
   * Address of the bot contract
   */
  address: Address;
  /**
   * Status of the bot
   */
  status: HealthStatusCode;
  /**
   * Minimum health factor of accounts that the bot can deleverage, in basis points
   */
  minHealthFactor: number;
  /**
   * Health factor that the bot brings accounts to, in basis points
   */
  maxHealthFactor: number;
}

/**
 * Status of deleverage bots of a liquidator that runs in `deleverage` mode.
 */
export interface IDeleverageStatus {
  /**
   * Turns to `alert` when the number of loaded bots is not exactly one
   */
  status: HealthStatusCode;
  /**
   * Loaded bots
   */
  bots: IDeleverageBotStatus[];
}

/**
 * Health response of a liquidator.
 */
export interface ILiquidatorHealthResponse
  extends ISDKHealthResponse,
    IWalletHealthResponse {
  family: "liquidators";
  /**
   * Liquidation strategy of the liquidator
   */
  liquidationMode: LiquidationMode;
  /**
   * Number of accounts that were liquidatable during the latest scan.
   *
   * Its status turns to `alert` when there is at least one such account.
   * Absent in legacy liquidators.
   */
  liquidatableAccounts?: HealthStatusValue<number>;
  /**
   * Lower bound of health factors of accounts that the liquidator scans, in basis points (`10000` is `1.0`)
   */
  minHealthFactor?: bigint;
  /**
   * Upper bound of health factors of accounts that the liquidator scans, in basis points (`10000` is `1.0`)
   */
  maxHealthFactor?: bigint;
  /**
   * Present only when the liquidator runs in `deleverage` mode
   */
  deleverage?: IDeleverageStatus;
}

/**
 * Health response of the insolvency monitor.
 */
export interface IInsolvencyMonitorHealthResponse
  extends ISDKHealthResponse,
    IWalletHealthResponse {
  family: "insolvency-monitor";
  /**
   * Solvency check over pools.
   *
   * `total` is the number of checked pools, `failed` is the number of pools that are insolvent or could not be checked.
   * Its status turns to `alert` when at least one pool failed.
   */
  insolvencyStats: HealthFailureStats;
}

/**
 * Health response of the price monitor.
 */
export interface IPriceMonitorHealthResponse extends ISDKHealthResponse {
  family: "price-monitor";
  /**
   * Check over price feeds.
   *
   * `total` is the number of checked feeds, ignored feeds are excluded.
   * `failed` is the number of failed feeds, excluding ignored.
   * Its status turns to `alert` when at least one feed failed.
   */
  feeds: HealthFailureStats;
}

/**
 * Accounts processed by the latest optimist run.
 */
export interface IOptimistAccountsStats {
  /**
   * Number of accounts that were liquidated
   */
  liquidated: number;
  /**
   * Number of liquidatable accounts that were discovered
   */
  discovered: number;
  /**
   * Turns to `alert` when some discovered accounts could not be liquidated
   */
  status: HealthStatusCode;
}

/**
 * Health response of a scheduled optimistic liquidator.
 *
 * The optimist does not serve it, the monitoring lambda builds it from {@link ScheduledOptimistInfo}.
 */
export interface IOptimistHealthResponse extends IBaseHealthResponse {
  family: "optimists";
  /**
   * Network that the optimist runs on
   */
  network: NetworkType;
  /**
   * Id of the latest execution
   */
  executionId: string;
  /**
   * Accounts processed by the latest execution
   */
  accounts: IOptimistAccountsStats;
}

/**
 * Health response of the multisig watcher.
 */
export interface IMultisigWatcherHealthResponse extends IBaseHealthResponse {
  family: "multisig-watcher";
  /**
   * Safe multisigs that are watched
   */
  safeAddresses: string[];
}

/**
 * Health response of any known service.
 */
export type IHealthResponse =
  | IMultisigWatcherHealthResponse
  | ISDKHealthResponse
  | ILiquidatorHealthResponse
  | IInsolvencyMonitorHealthResponse
  | IPriceMonitorHealthResponse
  | IMultichainHealthResponse
  | IBaseHealthResponse
  | IOptimistHealthResponse;

/**
 * Unexpected restarts of a service, counted by the monitoring lambda.
 */
export interface IServiceRestarts {
  /**
   * Turns to `alert` when there was at least one restart in the period
   */
  status: HealthStatusCode;
  /**
   * Number of unexpected restarts in the period
   */
  count: number;
  /**
   * Period, in hours
   */
  period: number;
}

/**
 * Service as known to the monitoring lambda, regardless of whether it responds.
 */
export interface IMonitoredService {
  /**
   * Unique service id
   */
  id: string;
  /**
   * Network that the service runs on, absent for services that are not bound to a network
   */
  network?: NetworkType;
  /**
   * Service family, groups services of the same kind in the dashboard
   */
  family?: string;
  /**
   * Human-readable description
   */
  description?: string;
  /**
   * Present when the restarts count is known
   */
  restarts?: IServiceRestarts;
}

/**
 * Entry of a service that responded with its health response.
 */
export type IHealthStatusHealthy = {
  /**
   * Status reported by the service, possibly escalated by the monitoring lambda (e.g. because of restarts)
   */
  status: HealthStatusCode;
} & IMonitoredService &
  Omit<IHealthResponse, "status">;

/**
 * Entry of a service whose health endpoint could not be reached.
 */
export type IHealthStatusNotResponding = {
  status: "not_responding";
  /**
   * Why the health endpoint could not be reached
   */
  error: string;
} & IMonitoredService;

/**
 * Entry of a service that can be deployed, but is not.
 */
export type IHealthStatusNotDeployed = {
  status: "not_deployed";
  /**
   * Why the service is not deployed
   */
  reason?: string;
} & IMonitoredService;

/**
 * Entry of a single service in {@link IMonitoringResult}.
 */
export type IHealthStatus =
  | IHealthStatusHealthy
  | IHealthStatusNotResponding
  | IHealthStatusNotDeployed;

/**
 * Snapshot of all services, gathered by the monitoring lambda and displayed by the dashboard.
 */
export interface IMonitoringResult {
  /**
   * Time when the snapshot was gathered, in unix seconds
   */
  timestamp: number;
  /**
   * All monitored services
   */
  services: IHealthStatus[];
}

/**
 * Fields of every optimist execution summary.
 */
export interface IOptimistExecutionBase {
  /**
   * Version of the optimist
   */
  version: string;
  /**
   * Time when the execution started, ISO 8601 string
   */
  startedAt: string;
  /**
   * Id of the execution
   */
  executionId: string;
  /**
   * Network that the optimist ran on
   */
  network: NetworkType;
}

/**
 * Summary of an optimist execution that produced a report.
 */
export interface IOptimistExecutionSuccess extends IOptimistExecutionBase {
  status: "success";
  /**
   * Number of discovered liquidatable accounts
   */
  discovered: number;
  /**
   * Number of accounts that none of the liquidators could liquidate, whitelisted accounts are excluded
   */
  failed: number;
}

/**
 * Summary of an optimist execution that failed before producing a report.
 */
export interface IOptimistExecutionFailed extends IOptimistExecutionBase {
  status: "failed";
}

/**
 * Summary that the optimist posts to anvil-manager after each execution.
 */
export type IOptimistExecutionSummary =
  | IOptimistExecutionSuccess
  | IOptimistExecutionFailed;

/**
 * Latest optimist execution on a network, as returned by anvil-manager.
 */
export type ScheduledOptimistInfo = IOptimistExecutionSummary & {
  /**
   * Time when anvil-manager received the summary, ISO 8601 string
   */
  finishedAt: string;
};
