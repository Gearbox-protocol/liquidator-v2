import type {
  OptimisticResult,
  PartialLiquidationCondition,
} from "@gearbox-protocol/types/optimist";
import type { Address, Hash, Hex, SimulateContractReturnType } from "viem";

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
  liquidate: (ca: CreditAccountData) => Promise<void>;
  /**
   *
   * @param ca
   * @param redstoneTokens
   * @returns true is account was successfully liquidated
   */
  liquidateOptimistic: (ca: CreditAccountData) => Promise<OptimisticResult>;
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

export interface ILiquidationStrategy<T extends StrategyPreview> {
  name: string;
  adverb: string;
  launch: () => Promise<void>;
  /**
   * Fetches credit account data again for optimistic report
   * @param ca
   * @returns
   */
  updateCreditAccountData: (
    ca: CreditAccountData,
  ) => Promise<CreditAccountData>;
  /**
   * For optimistic liquidations only: create conditions that make this account liquidatable
   * If strategy implements this scenario, it must make evm_snapshot beforehand and return it as a result
   * Id strategy does not support this, return undefined
   * @param ca
   * @returns evm snapshotId or underfined
   */
  makeLiquidatable: (ca: CreditAccountData) => Promise<MakeLiquidatableResult>;
  preview: (ca: CreditAccountData) => Promise<T>;
  /**
   * Simulates liquidation
   * @param account
   * @param preview
   * @returns
   */
  simulate: (
    account: CreditAccountData,
    preview: T,
  ) => Promise<SimulateContractReturnType>;
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
