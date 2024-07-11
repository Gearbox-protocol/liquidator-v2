import type { PartialLiquidationCondition } from "@gearbox-protocol/types/optimist";
import type { Address, Hash, Hex, TransactionReceipt } from "viem";

import type {
  CreditAccountData,
  MultiCall,
  PriceOnDemand,
} from "../../data/index.js";

export interface PriceOnDemandExtras extends PriceOnDemand {
  ts: number;
  reserve: boolean;
}

export interface PriceUpdate {
  token: Address;
  data: `0x${string}`;
  reserve: boolean;
}

export interface PartialLiquidationPreview {
  calls: MultiCall[];
  assetOut: Address;
  amountOut: bigint;
  flashLoanAmount: bigint;
  underlyingBalance: bigint;
  priceUpdates: PriceUpdate[];
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
  calls: MultiCall[];
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
  priceUpdates?: PriceUpdate[];
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

export interface BatchLiquidationResult {
  receipt: TransactionReceipt;
  liquidated: CreditAccountData[];
  notLiquidated: CreditAccountData[];
}
