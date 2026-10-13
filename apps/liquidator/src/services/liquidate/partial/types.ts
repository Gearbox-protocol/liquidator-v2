import type { PartialStrategyPreview } from "@gearbox-protocol/liquidator-v2-config";
import type {
  AddressMap,
  CreditAccountData,
  CreditSuite,
  MultiCall,
  OptimalPartialLiquidation,
  PriceUpdate,
} from "@gearbox-protocol/sdk/onchain";
import type { Address } from "viem";
import type { LiquidationRequest } from "../types.js";

export interface RawPartialLiquidationPreview {
  profit: bigint;
  calls: readonly MultiCall[];
  amountIn: bigint;
  amountOut: bigint;
}

/**
 * Conversion of seized collateral into underlying, routed only to load router state into fork cache
 */
export interface ConversionWarmUpTask {
  creditManager: Address;
  /**
   * Token to convert, already mapped from phantom token to its deposited token
   */
  tokenIn: Address;
  amountIn: bigint;
  underlying: Address;
}

export interface IPartialLiquidatorContract {
  address: Address;
  name: string;
  version: number;
  envVariables: Record<string, string>;
  /**
   * Queues credit manager that uses this partial lqiuidation/deleverage contract for registration
   * Registraction will be performed during next syncState
   * @param cm
   */
  queueCreditManagerRegistration: (cm: CreditSuite) => Promise<void>;
  /**
   * Performs all actions necessary to make the contract ready for use
   * This includes deploying contracts if necessary, setting router, registering credit managers, etc.
   */
  syncState: () => Promise<void>;
  /**
   * Computes optimal partial liquidation off-chain via sdk, using this contract's optimal health factor
   * @param ca
   * @param liquidationThresholds LTs to use instead of the credit manager's cached ones, e.g. LTs just lowered on a fork
   */
  getOptimalLiquidation: (
    ca: CreditAccountData,
    liquidationThresholds?: AddressMap<number>,
  ) => OptimalPartialLiquidation;
  /**
   * Call to previewPartialLiquidation on liquidator contracts for v310 routers
   * @param ca
   * @param cm
   * @param optimalLiquidation
   * @param priceUpdates
   */
  previewPartialLiquidation: (
    ca: CreditAccountData,
    cm: CreditSuite,
    optimalLiquidation: OptimalPartialLiquidation,
    priceUpdates: PriceUpdate[],
  ) => Promise<RawPartialLiquidationPreview>;
  /**
   * Call to partialLiquidateAndConvert on liquidator contracts for v310 routers
   * @param account
   * @param preview
   */
  partialLiquidateAndConvert: (
    account: CreditAccountData,
    preview: PartialStrategyPreview<bigint>,
  ) => Promise<LiquidationRequest>;
  /**
   * Read-only router call with the same arguments previewPartialLiquidation uses for conversion,
   * result is discarded. Throws if the call reverts
   * @param task
   */
  warmUpConversion: (task: ConversionWarmUpTask) => Promise<void>;
}

export interface IPartialLiqudatorContractFactory {
  tryAttach: (cm: CreditSuite) => IPartialLiquidatorContract | undefined;
}
