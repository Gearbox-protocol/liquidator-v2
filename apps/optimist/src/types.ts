import type { OptimisticResult } from "@gearbox-protocol/liquidator-v2-config";
import type { NetworkType, OnchainSDK } from "@gearbox-protocol/sdk/onchain";
import type { AccountsPlugin } from "@gearbox-protocol/sdk/plugins/accounts";
import type { Address } from "viem";

// liquidators produce files with this schema
export interface OptimisticFile {
  startBlock: number;
  result: OptimisticResult[] | null;
}

export interface TrackResult {
  /**
   * Id to distinguish say full and partial TS liquidators
   */
  id: string;
  /**
   * Human-readable track name
   */
  name: string;
  /**
   * Actually used liquidator image version
   */
  version: string;
  start: Date;
  end: Date;
  /**
   * liquidator failed before producing any output
   */
  error?: string;
  /**
   * might contain results for different credit managers
   */
  results: OptimisticResult[];
}

export interface ITrack {
  id: string;
  status: string;
  completed: boolean;
  run: (blockNumber: bigint) => Promise<TrackResult>;
}

export interface CreditManagerSlice {
  addr: Address;
  name: string;
  underlying: Address;
}

export type TypedSDK = OnchainSDK<{
  readonly accounts: AccountsPlugin;
}>;

export interface ExecutionSummarySuccess {
  version: string;
  startedAt: string;
  executionId: string;
  network: NetworkType;
  status: "success";
  /**
   * Number of discovered accounts
   */
  discovered: number;
  /**
   * Number of accounts that none of liquidators could liquidate
   */
  failed: number;
}

export interface ExecutionSummaryFailed {
  version: string;
  startedAt: string;
  executionId: string;
  network: NetworkType;
  status: "failed";
}

export type ExecutionSummary = ExecutionSummarySuccess | ExecutionSummaryFailed;
