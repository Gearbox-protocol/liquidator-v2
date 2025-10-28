import type {
  CreditAccountData,
  MultiCall,
  RawTx,
} from "@gearbox-protocol/sdk";
import type { PartialLiquidationCondition } from "@gearbox-protocol/types/optimist";
import type { Address, Hex } from "viem";

export interface FullLiquidationPreview extends StrategyPreview {
  amount: bigint;
  minAmount: bigint;
  rawTx: RawTx;
}

export interface PartialLiquidationPreview {
  calls: MultiCall[];
  assetOut: Address;
  amountOut: bigint;
  flashLoanAmount: bigint;
  underlyingBalance: bigint;
  priceUpdates: unknown[];
  skipOnFailure?: boolean;
}

export type PartialLiquidationPreviewWithFallback =
  | (PartialLiquidationPreview & {
      fallback: false;
    })
  | (FullLiquidationPreview & { fallback: true });

export interface ILiquidatorService {
  launch: (asFallback?: boolean) => Promise<void>;
  syncState: (blockNumber: bigint) => Promise<void>;
  liquidate: (accounts: CreditAccountData[]) => Promise<void>;
  /**
   *
   * @param ca
   * @param redstoneTokens
   * @returns true is account was successfully liquidated
   */
  liquidateOptimistic: (accounts: CreditAccountData[]) => Promise<void>;
}

export interface StrategyPreview {
  calls: readonly MultiCall[];
  underlyingBalance: bigint;
  /**
   * Asset in case of partial liquidation
   */
  assetOut?: Address;
  /**
   * Asset amount in case of partial liquidation
   */
  amountOut?: bigint;
  /**
   * Falsh loan amount in case of partial liquidation
   */
  flashLoanAmount?: bigint;
  /**
   * If true, will not attempt to liquidate this account again
   */
  skipOnFailure?: boolean;
}

export interface MakeLiquidatableResult {
  snapshotId?: Hex;
  partialLiquidationCondition?: PartialLiquidationCondition<bigint>;
}
