import type {
  CreditAccountData,
  MultiCall,
  OnDemandPriceUpdate,
} from "@gearbox-protocol/sdk";
import type { PartialLiquidationCondition } from "@gearbox-protocol/types/optimist";
import type { Address, Hash, Hex } from "viem";

export interface PartialLiquidationPreview {
  calls: MultiCall[];
  assetOut: Address;
  amountOut: bigint;
  flashLoanAmount: bigint;
  underlyingBalance: bigint;
  priceUpdates: OnDemandPriceUpdate[];
  skipOnFailure?: boolean;
}

export interface ILiquidatorService {
  launch: () => Promise<void>;
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
  partialLiquidationCondition?: PartialLiquidationCondition;
}

export interface MerkleDistributorInfo {
  merkleRoot: Hash;
  tokenTotal: string;
  claims: Record<
    Address,
    {
      index: number;
      amount: string;
      proof: Hash[];
    }
  >;
}
