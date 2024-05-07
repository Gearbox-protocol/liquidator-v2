import type { MultiCall, PriceOnDemand } from "@gearbox-protocol/types/v3";
import type { TransactionReceipt } from "ethers";

import type { CreditAccountData } from "../../utils/ethers-6-temp";

export interface PriceOnDemandExtras extends PriceOnDemand {
  ts: number;
  reserve: boolean;
}

export interface PriceUpdate {
  token: string;
  data: string;
  reserve: boolean;
}

export interface PartialLiquidationPreview {
  calls: MultiCall[];
  assetOut: string;
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
  assetOut?: string;
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

/**
 * Original result format, shared by both liquidators (TS and GO)
 */
export interface OptimisticResult {
  /**
   * Credit Manager address
   */
  creditManager: string;

  /**
   * Borrower address
   */
  borrower: string;

  /**
   * Credit account address
   */
  account: string;

  /**
   * Gas used for liquidation from tx recepit
   */
  gasUsed: number;

  /**
   * Multicalls used as parameter in liquidateCreditAccount function
   */
  calls: MultiCall[];

  /**
   * Estimated amount which was computed in pathfinder
   */
  pathAmount: string;

  /**
   * How much tokens liquidator got on its account for the liquidation
   * liquidatorPremium = underlyingBalanceAfterLiquidation - underlyingBalanceBeforeLiquidation
   */
  liquidatorPremium: string;
  /**
   * Difference between liquidator ETH balance before and after liquidation and swapping of underlying back to ETH
   */
  liquidatorProfit: string;

  /**
   * True if errors accrued
   */
  isError: boolean;

  /**
   * How much time it took to liquidate this account (ms)
   */
  duration?: number;
}

export interface MakeLiquidatableResult {
  snapshotId?: number;
  partialLiquidationCondition?: PartialLiquidationCondition;
}

export interface OptimisticResultV2 extends OptimisticResult {
  /**
   * Flag to distinguish v2 format
   */
  version: "2";
  /**
   * Parsed version of calls
   * Reasone why we do it here is that parser is available in gearbox SDK only, which uses ethers-5 and cannot be imported in other places
   */
  callsHuman: string[];
  /**
   * Token balances before liquidation
   */
  balancesBefore: Record<string, bigint>;
  /**
   * Token after (partial) liquidation
   */
  balancesAfter: Record<string, bigint>;
  /**
   * Health factor before liquidation
   */
  hfBefore: number;
  /**
   * Health factor after (partial) liquidation
   */
  hfAfter: number;

  /**
   * Error occured during liquidation
   */
  error?: string;

  /**
   * Changes made to enable partial liquidation of account
   */
  partialLiquidationCondition?: PartialLiquidationCondition;

  /**
   * Asset in case of partial liquidation
   */
  assetOut?: string;
  /**
   * Asset amount in case of partial liquidation
   */
  amountOut?: bigint;
  /**
   * Falsh loan amount in case of partial liquidation
   */
  flashLoanAmount?: bigint;

  /**
   * On-demand (redstone) price updates in liquidation call
   */
  priceUpdates?: PriceUpdate[];
}

export interface PartialLiquidationCondition {
  ltChanges: Record<string, [bigint, bigint]>;
  hfNew: number;
}
