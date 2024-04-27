import type { MultiCall } from "@gearbox-protocol/sdk";

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
  calls: Array<MultiCall>;

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

export interface OptimisticResultV2 extends OptimisticResult {
  /**
   * Flag to distinguish v2 format
   */
  version: "2";
  /**
   * Parsed version of calls
   * It's done on liquidator side for following reasons:
   * - TxParser lives in @gearbox-protocol/sdk which uses ethers-v5
   * - TxParser is static and cannot be used on forks, because fork state will be mixed
   */
  callsHuman: string[];
  /**
   * Token balances before liquidation
   */
  balancesBefore: Record<string, bigint>;
  /**
   * Health factor before liquidation
   */
  hfBefore: number;

  /**
   * Error occured during liquidation
   */
  error?: string;
}
