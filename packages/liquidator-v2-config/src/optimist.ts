import type { MultiCall } from "@gearbox-protocol/sdk";
import type { Address } from "viem";

export interface PriceUpdate {
  token: Address;
  data: string;
  reserve: boolean;
}

export type Numberish = number | string | bigint;

export interface PartialLiquidationCondition<N extends Numberish = Numberish> {
  /**
   * Mapping token address -> [old LT, new LT]
   */
  ltChanges?: Record<Address, [ltOld: N, ltNew: N]> | null;
  /**
   * Account health factor after changing LTs
   */
  hfNew: N;
}

/**
 * Optimistic liquidation result format, shared by all liquidators
 */
export interface OptimisticResult<N extends Numberish = Numberish> {
  /**
   * Credit Manager address
   */
  creditManager: Address;
  /**
   * Borrower address
   */
  borrower: Address;
  /**
   * Credit account address
   */
  account: Address;
  /**
   * Gas used for liquidation from tx recepit
   */
  gasUsed: N;
  /**
   * Multicalls used as parameter in liquidateCreditAccount function
   * Can be null or undfined in case of error
   */
  calls?: MultiCall[] | null;
  /**
   * Estimated amount which was computed in pathfinder
   */
  pathAmount: N;
  /**
   * How much tokens liquidator got on its account for the liquidation
   * liquidatorPremium = underlyingBalanceAfterLiquidation - underlyingBalanceBeforeLiquidation
   */
  liquidatorPremium: N;
  /**
   * Difference between liquidator ETH balance before and after liquidation and swapping of underlying back to ETH
   */
  liquidatorProfit: N;
  /**
   * True if errors accrued
   */
  isError: boolean;
  /**
   * How much time it took to liquidate this account (ms)
   */
  duration?: number;
  /**
   * Parsed version of calls
   * Reason why we do it here is that parser is available in gearbox SDK only, which uses ethers-5 and cannot be imported in other places
   * This field is not available in all the liquidators
   */
  callsHuman?: string[] | null;
  /**
   * Token balances before liquidation
   */
  balancesBefore: Record<Address, N>;
  /**
   * Token after (partial) liquidation
   */
  balancesAfter: Record<Address, N>;
  /**
   * Health factor before liquidation
   */
  hfBefore: N;
  /**
   * Health factor after (partial) liquidation
   */
  hfAfter: N;
  /**
   * Error occured during liquidation
   */
  error?: string;
  /**
   * In case of error, cast call --trace ansii file name
   */
  traceFile?: string;
  /**
   * Changes made to enable partial liquidation of account
   */
  partialLiquidationCondition?: PartialLiquidationCondition<N>;
  /**
   * Asset in case of partial liquidation
   */
  assetOut?: Address | null;
  /**
   * Asset amount in case of partial liquidation
   */
  amountOut?: N | null;
  /**
   * Falsh loan amount in case of partial liquidation
   */
  flashLoanAmount?: N | null;
  /**
   * On-demand (redstone) price updates in liquidation call
   */
  priceUpdates?: PriceUpdate[] | null;
  /**
   * In case when account are liquidated in batches
   */
  batchId?: string;
}
