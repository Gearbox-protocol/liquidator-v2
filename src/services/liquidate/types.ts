import type { CreditAccountData, MultiCall } from "@gearbox-protocol/sdk";
import type {
  BigNumberish,
  ContractTransaction,
  providers,
  Wallet,
} from "ethers";

import type { LoggerInterface } from "../../log";
import type { AddressProviderService } from "../AddressProviderService";
import type { KeyService } from "../keyService";
import type { RedstoneServiceV3 } from "../RedstoneServiceV3";
import type { MultiCallStructOutput } from "./generated/ILiquidator";

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
  underlyingBalance: bigint;
}

export interface ILiquidatorService {
  launch: (provider: providers.Provider) => Promise<void>;
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

export interface StrategyOptions {
  logger: LoggerInterface;
  provider: providers.Provider;
  addressProvider: AddressProviderService;
  redstone?: RedstoneServiceV3;
  keyService?: KeyService;
}

export interface ILiquidationStrategy<T extends StrategyPreview> {
  name: string;
  adverb: string;
  launch: (options: StrategyOptions) => Promise<void>;
  preview: (ca: CreditAccountData, slippage: number) => Promise<T>;
  estimate: (
    executor: Wallet,
    account: CreditAccountData,
    preview: T,
    recipient: string,
  ) => Promise<BigNumberish>;
  liquidate: (
    executor: Wallet,
    account: CreditAccountData,
    preview: T,
    recipient: string,
    gasLimit?: BigNumberish,
  ) => Promise<ContractTransaction>;
}
