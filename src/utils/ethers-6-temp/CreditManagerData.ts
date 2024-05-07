import {
  PERCENTAGE_DECIMALS,
  PERCENTAGE_FACTOR,
  RAY,
} from "@gearbox-protocol/sdk-gov";
import type {
  CreditManagerDataStructOutput,
  LinearModel,
  QuotaInfo,
} from "@gearbox-protocol/types/v3";

export class CreditManagerData {
  readonly address: string;
  readonly underlyingToken: string;
  readonly pool: string;
  readonly creditFacade: string; // V2 only: address of creditFacade
  readonly creditConfigurator: string; // V2 only: address of creditFacade
  readonly degenNFT: string; // V2 only: degenNFT, address(0) if not in degen mode
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

  readonly collateralTokens: Array<string> = [];
  readonly supportedTokens: Record<string, true> = {};
  readonly adapters: Record<string, string>;
  readonly contractsByAdapter: Record<string, string>;
  readonly liquidationThresholds: Record<string, bigint>;
  readonly quotas: Record<string, QuotaInfo>;
  readonly interestModel: LinearModel;

  constructor(payload: CreditManagerDataStructOutput) {
    this.address = payload.addr.toLowerCase();
    this.underlyingToken = payload.underlying.toLowerCase();
    this.name = payload.name;
    this.pool = payload.pool.toLowerCase();
    this.creditFacade = payload.creditFacade.toLowerCase();
    this.creditConfigurator = payload.creditConfigurator.toLowerCase();
    this.degenNFT = payload.degenNFT.toLowerCase();
    this.isDegenMode = payload.isDegenMode;
    this.version = Number(payload.cfVersion);
    this.isPaused = payload.isPaused;
    this.forbiddenTokenMask = payload.forbiddenTokenMask;

    this.baseBorrowRate = Number(
      (payload.baseBorrowRate *
        (payload.feeInterest + PERCENTAGE_FACTOR) *
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
      const tLc = t.toLowerCase();

      this.collateralTokens.push(tLc);
      this.supportedTokens[tLc] = true;
    });

    this.adapters = Object.fromEntries(
      payload.adapters.map(a => [
        a.targetContract.toLowerCase(),
        a.adapter.toLowerCase(),
      ]),
    );

    this.contractsByAdapter = Object.fromEntries(
      payload.adapters.map(a => [
        a.adapter.toLowerCase(),
        a.targetContract.toLowerCase(),
      ]),
    );

    this.liquidationThresholds = payload.liquidationThresholds.reduce<
      Record<string, bigint>
    >((acc, threshold, index) => {
      const address = payload.collateralTokens[index];
      if (address) acc[address.toLowerCase()] = threshold;
      return acc;
    }, {});

    this.quotas = Object.fromEntries(
      payload.quotas.map(q => [
        q.token.toLowerCase(),
        {
          token: q.token.toLowerCase(),
          rate: q.rate * PERCENTAGE_DECIMALS,
          quotaIncreaseFee: q.quotaIncreaseFee,
          totalQuoted: q.totalQuoted,
          limit: q.limit,
          isActive: q.isActive,
        },
      ]),
    );

    this.interestModel = {
      interestModel: payload.lirm.interestModel.toLowerCase(),
      U_1: payload.lirm.U_1,
      U_2: payload.lirm.U_2,
      R_base: payload.lirm.R_base,
      R_slope1: payload.lirm.R_slope1,
      R_slope2: payload.lirm.R_slope2,
      R_slope3: payload.lirm.R_slope3,
      version: payload.lirm.version,
      isBorrowingMoreU2Forbidden: payload?.lirm?.isBorrowingMoreU2Forbidden,
    };
  }
}
