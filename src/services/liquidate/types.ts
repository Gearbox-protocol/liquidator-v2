import type {
  OptimisticResultV2,
  PartialLiquidationCondition,
} from "@gearbox-protocol/types/optimist";
import type { MultiCall } from "@gearbox-protocol/types/v3";
import type { TransactionReceipt } from "ethers";
import type { Address } from "viem";

import type { CreditAccountData } from "../../utils/ethers-6-temp/index.js";
import type { PriceOnDemand } from "../../utils/types.js";

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
  liquidateOptimistic: (ca: CreditAccountData) => Promise<OptimisticResultV2>;
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
  estimate: (account: CreditAccountData, preview: T) => Promise<bigint>;
  liquidate: (
    account: CreditAccountData,
    preview: T,
    gasLimit?: bigint,
  ) => Promise<TransactionReceipt>;
}

export interface MakeLiquidatableResult {
  snapshotId?: number;
  partialLiquidationCondition?: PartialLiquidationCondition;
}
