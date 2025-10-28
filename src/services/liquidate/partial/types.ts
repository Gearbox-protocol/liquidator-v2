import type {
  CreditAccountData,
  CreditSuite,
  MultiCall,
  OnDemandPriceUpdates,
} from "@gearbox-protocol/sdk";
import type { Address, Hash, SimulateContractReturnType } from "viem";

import type { PartialLiquidationPreview } from "../types.js";

export interface OptimalPartialLiquidation {
  tokenOut: Address;
  optimalAmount: bigint;
  repaidAmount: bigint;
  flashLoanAmount: bigint;
  isOptimalRepayable: boolean;
}

export interface RawPartialLiquidationPreview {
  profit: bigint;
  calls: readonly MultiCall[];
  amountIn: bigint;
  amountOut: bigint;
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
  queueCreditManagerRegistration: (cm: CreditSuite) => void;
  /**
   * Performs all actions necessary to make the contract ready for use
   * This includes deploying contracts if necessary, setting router, registering credit managers, etc.
   */
  syncState: () => Promise<void>;
  /**
   * Cross-version call to getOptimalLiquidation on liquidator contracts for rouuters v300 and v310
   * @param ca
   * @param priceUpdates
   */
  getOptimalLiquidation: (
    ca: CreditAccountData,
    priceUpdates: OnDemandPriceUpdates,
  ) => Promise<OptimalPartialLiquidation>;
  /**
   * Cross-version call to previewPartialLiquidation on liquidator contracts for rouuters v300 and v310
   * @param ca
   * @param cm
   * @param optimalLiquidation
   * @param priceUpdates
   */
  previewPartialLiquidation: (
    ca: CreditAccountData,
    cm: CreditSuite,
    optimalLiquidation: OptimalPartialLiquidation,
    priceUpdates: OnDemandPriceUpdates,
  ) => Promise<RawPartialLiquidationPreview>;
  /**
   * Cross-version call to partialLiquidateAndConvert on liquidator contracts for rouuters v300 and v310
   * @param account
   * @param preview
   */
  partialLiquidateAndConvert: (
    account: CreditAccountData,
    preview: PartialLiquidationPreview,
  ) => Promise<SimulateContractReturnType<unknown[], any, any>>;
}

export interface IPartialLiqudatorContractFactory {
  tryAttach: (cm: CreditSuite) => IPartialLiquidatorContract | undefined;
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
