import type {
  CreditAccountData,
  MultiCall,
  RawTx,
} from "@gearbox-protocol/sdk";
import type { PartialLiquidationCondition } from "@gearbox-protocol/types/optimist";
import type {
  Address,
  Hex,
  RequiredBy,
  SimulateContractReturnType,
} from "viem";

export interface LiquidationPreview {
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

export interface FullLiquidationPreview extends LiquidationPreview {
  amount: bigint;
  minAmount: bigint;
  rawTx: RawTx;
}

export interface PartialLiquidationPreview
  extends RequiredBy<
    LiquidationPreview,
    "calls" | "assetOut" | "amountOut" | "flashLoanAmount" | "underlyingBalance"
  > {
  underlyingBalance: bigint;
  priceUpdates: unknown[];
}

export interface ILiquidatorService {
  launch: () => Promise<void>;
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

export interface MakeLiquidatableResult {
  snapshotId?: Hex;
  partialLiquidationCondition?: PartialLiquidationCondition<bigint>;
}

export interface ILiquidationStrategyResult<P> {
  /**
   * All data required to generate transaction that liquidates account
   */
  preview: P;
  simulate: SimulateContractReturnType<unknown[], any, any>;
}

export interface ILiquidationStrategy<
  P extends LiquidationPreview = LiquidationPreview,
> {
  name: string;

  launch: () => Promise<void>;
  syncState: (blockNumber: bigint) => Promise<void>;
  /**
   * For optimistic liquidations only: create conditions that make this account liquidatable
   * If strategy implements this scenario, it must make evm_snapshot beforehand and return it as a result
   * Id strategy does not support this, return undefined
   * @param ca
   * @returns evm snapshotId or underfined
   */
  makeLiquidatable: (ca: CreditAccountData) => Promise<MakeLiquidatableResult>;

  /**
   * Gathers all data required to generate transaction that liquidates account
   * @param ca
   */
  preview: (ca: CreditAccountData) => Promise<P>;
  /**
   * Using data gathered by preview step, simulates transaction.
   * That is, nothing is actually written, but the gas is estimated, for example.
   * In optimistic mode, we create snapshot after that state so that all the loaded storage slots are not reverted on next account.
   *
   * Returned transaction data then can be used to send actual transaction.
   * Gas manipulations can be made thanks to estimation data returned by simulate call.
   * @param account
   * @param preview
   * @returns
   */
  simulate: (
    account: CreditAccountData,
    preview: P,
  ) => Promise<SimulateContractReturnType<unknown[], any, any>>;
}
