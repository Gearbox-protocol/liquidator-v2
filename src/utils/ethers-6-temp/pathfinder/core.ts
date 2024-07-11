import type { Address } from "viem";

import type { Balance } from "../../../data/Balance.js";
import type { MultiCall } from "../../../data/MultiCall.js";
import type { PathOption } from "./pathOptions.js";

export enum SwapOperation {
  EXACT_INPUT,
  EXACT_INPUT_ALL,
  EXACT_OUTPUT,
}

export interface PathFinderResult {
  amount: bigint;
  minAmount: bigint;
  calls: MultiCall[];
}

export interface PathFinderOpenStrategyResult extends PathFinderResult {
  balances: Record<Address, bigint>;
  minBalances: Record<Address, bigint>;
}

export interface PathFinderCloseResult extends PathFinderResult {
  underlyingBalance: bigint;
}

/**
 * RouterLiqParams in contract
 */
export interface EstimateBatchInput {
  creditAccount: Address;
  expectedBalances: Balance[];
  leftoverBalances: Balance[];
  connectors: Address[];
  slippage: bigint;
  pathOptions: PathOption[];
  iterations: bigint;
  force: boolean;
}
