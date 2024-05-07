import type { MultiCall, RouterResult } from "@gearbox-protocol/types/v3";

export enum SwapOperation {
  EXACT_INPUT,
  EXACT_INPUT_ALL,
  EXACT_OUTPUT,
}

export type PathFinderResult = Omit<RouterResult, "calls"> & {
  calls: MultiCall[];
};

export interface PathFinderOpenStrategyResult extends PathFinderResult {
  balances: Record<string, bigint>;
  minBalances: Record<string, bigint>;
}

export interface PathFinderCloseResult extends PathFinderResult {
  underlyingBalance: bigint;
}
