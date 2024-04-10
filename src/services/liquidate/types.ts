import type { MultiCallStructOutput } from "@gearbox-protocol/liquidator-v2-contracts/dist/IRouterV3";
import type { CreditAccountData, MultiCall } from "@gearbox-protocol/sdk";
import type { BigNumberish, ContractReceipt } from "ethers";

export interface PriceOnDemand {
  token: string;
  callData: string;
}

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
  calls: MultiCallStructOutput[];
  assetOut: string;
  amountOut: bigint;
  flashLoanAmount: bigint;
  underlyingBalance: bigint;
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
  liquidateOptimistic: (ca: CreditAccountData) => Promise<boolean>;
}

export interface StrategyPreview {
  calls: MultiCall[];
  underlyingBalance: bigint;
}

export interface ILiquidationStrategy<T extends StrategyPreview> {
  name: string;
  adverb: string;
  launch: () => Promise<void>;
  preview: (ca: CreditAccountData, slippage: number) => Promise<T>;
  estimate: (account: CreditAccountData, preview: T) => Promise<BigNumberish>;
  liquidate: (
    account: CreditAccountData,
    preview: T,
    gasLimit?: BigNumberish,
  ) => Promise<ContractReceipt>;
}
