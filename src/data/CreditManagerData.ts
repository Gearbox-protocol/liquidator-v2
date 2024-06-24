import {
  PERCENTAGE_DECIMALS,
  PERCENTAGE_FACTOR,
  RAY,
} from "@gearbox-protocol/sdk-gov";
import type { Address } from "viem";

import type { Arrayish, Numberish } from "../utils/index.js";

export interface CreditManagerDataRaw {
  addr: string;
  name: string;
  cfVersion: Numberish;
  creditFacade: string;
  creditConfigurator: string;
  underlying: string;
  pool: string;
  totalDebt: Numberish;
  totalDebtLimit: Numberish;
  baseBorrowRate: Numberish;
  minDebt: Numberish;
  maxDebt: Numberish;
  availableToBorrow: Numberish;
  collateralTokens: Arrayish<string>;
  adapters: Arrayish<{
    targetContract: string;
    adapter: string;
  }>;
  liquidationThresholds: Arrayish<bigint>;
  isDegenMode: boolean;
  degenNFT: string;
  forbiddenTokenMask: Numberish;
  maxEnabledTokensLength: Numberish;
  feeInterest: Numberish;
  feeLiquidation: Numberish;
  liquidationDiscount: Numberish;
  feeLiquidationExpired: Numberish;
  liquidationDiscountExpired: Numberish;
  quotas: Arrayish<{
    token: string;
    rate: Numberish;
    quotaIncreaseFee: Numberish;
    totalQuoted: Numberish;
    limit: Numberish;
    isActive: boolean;
  }>;
  lirm: {
    interestModel: string;
    version: Numberish;
    U_1: Numberish;
    U_2: Numberish;
    R_base: Numberish;
    R_slope1: Numberish;
    R_slope2: Numberish;
    R_slope3: Numberish;
    isBorrowingMoreU2Forbidden: boolean;
  };
  isPaused: boolean;
}

export class CreditManagerData {
  readonly address: Address;
  readonly underlyingToken: Address;
  readonly pool: Address;
  readonly creditFacade: Address;
  readonly creditConfigurator: Address;
  readonly degenNFT: Address;
  readonly isDegenMode: boolean;
  readonly version: number;
  readonly isPaused: boolean;
  readonly forbiddenTokenMask: bigint; // V2 only: mask which forbids some particular tokens
  readonly name: string;

  readonly baseBorrowRate: number;

  readonly minDebt: bigint;
  readonly maxDebt: bigint;
  readonly availableToBorrow: bigint;
  readonly totalDebt: bigint;
  readonly totalDebtLimit: bigint;

  readonly feeInterest: number;
  readonly feeLiquidation: number;
  readonly liquidationDiscount: number;
  readonly feeLiquidationExpired: number;
  readonly liquidationDiscountExpired: number;

  readonly collateralTokens: Address[] = [];
  readonly supportedTokens: Record<Address, true> = {};
  readonly adapters: Record<Address, Address>;
  readonly contractsByAdapter: Record<Address, Address>;
  readonly liquidationThresholds: Record<Address, bigint> = {};

  constructor(payload: CreditManagerDataRaw) {
    this.address = payload.addr.toLowerCase() as Address;
    this.underlyingToken = payload.underlying.toLowerCase() as Address;
    this.name = payload.name;
    this.pool = payload.pool.toLowerCase() as Address;
    this.creditFacade = payload.creditFacade.toLowerCase() as Address;
    this.creditConfigurator =
      payload.creditConfigurator.toLowerCase() as Address;
    this.degenNFT = payload.degenNFT.toLowerCase() as Address;
    this.isDegenMode = payload.isDegenMode;
    this.version = Number(payload.cfVersion);
    this.isPaused = payload.isPaused;
    this.forbiddenTokenMask = BigInt(payload.forbiddenTokenMask);

    this.baseBorrowRate = Number(
      (BigInt(payload.baseBorrowRate) *
        (BigInt(payload.feeInterest) + PERCENTAGE_FACTOR) *
        PERCENTAGE_DECIMALS) /
        RAY,
    );

    this.minDebt = BigInt(payload.minDebt);
    this.maxDebt = BigInt(payload.maxDebt);
    this.availableToBorrow = BigInt(payload.availableToBorrow);
    this.totalDebt = BigInt(payload.totalDebt);
    this.totalDebtLimit = BigInt(payload.totalDebtLimit);

    this.feeInterest = Number(payload.feeInterest);
    this.feeLiquidation = Number(payload.feeLiquidation);
    this.liquidationDiscount = Number(payload.liquidationDiscount);
    this.feeLiquidationExpired = Number(payload.feeLiquidationExpired);
    this.liquidationDiscountExpired = Number(
      payload.liquidationDiscountExpired,
    );

    payload.collateralTokens.forEach(t => {
      const tLc = t.toLowerCase() as Address;

      this.collateralTokens.push(tLc);
      this.supportedTokens[tLc] = true;
    });

    this.adapters = Object.fromEntries(
      payload.adapters.map(a => [
        a.targetContract.toLowerCase() as Address,
        a.adapter.toLowerCase() as Address,
      ]),
    );

    this.contractsByAdapter = Object.fromEntries(
      payload.adapters.map(a => [
        a.adapter.toLowerCase() as Address,
        a.targetContract.toLowerCase() as Address,
      ]),
    );

    for (let i = 0; i < payload.liquidationThresholds.length; i++) {
      const threshold = payload.liquidationThresholds[i];
      const address = payload.collateralTokens[i]?.toLowerCase() as Address;
      if (address) {
        this.liquidationThresholds[address] = threshold;
      }
    }
  }
}
