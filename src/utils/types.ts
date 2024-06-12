import {
  PERCENTAGE_DECIMALS,
  PERCENTAGE_FACTOR,
  RAY,
} from "@gearbox-protocol/sdk-gov";
import type { iDataCompressorV3Abi } from "@gearbox-protocol/types/abi";
import type { AbiParameterToPrimitiveType, ExtractAbiFunction } from "abitype";
import type { Address, GetContractReturnType, PublicClient } from "viem";

export interface PriceOnDemand {
  token: `0x${string}`;
  callData: `0x${string}`;
}

export type IDataCompressorContract = GetContractReturnType<
  typeof iDataCompressorV3Abi,
  PublicClient
>;

export type CreditManagerDataRaw = AbiParameterToPrimitiveType<
  ExtractAbiFunction<
    typeof iDataCompressorV3Abi,
    "getCreditManagerData"
  >["outputs"]["0"]
>;

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
  readonly liquidationThresholds: Record<Address, bigint>;

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
    this.forbiddenTokenMask = payload.forbiddenTokenMask;

    this.baseBorrowRate = Number(
      (payload.baseBorrowRate *
        (BigInt(payload.feeInterest) + PERCENTAGE_FACTOR) *
        PERCENTAGE_DECIMALS) /
        RAY,
    );

    this.minDebt = payload.minDebt;
    this.maxDebt = payload.maxDebt;
    this.availableToBorrow = payload.availableToBorrow;
    this.totalDebt = payload.totalDebt;
    this.totalDebtLimit = payload.totalDebtLimit;

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

    this.liquidationThresholds = payload.liquidationThresholds.reduce<
      Record<Address, bigint>
    >((acc, threshold, index) => {
      const address = payload.collateralTokens[index];
      if (address) acc[address.toLowerCase() as Address] = threshold;
      return acc;
    }, {});
  }
}
