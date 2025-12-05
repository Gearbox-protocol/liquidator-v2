import {
  type CreditAccountData,
  type GearboxSDK,
  type ICreditAccountsService,
  PERCENTAGE_FACTOR,
  VERSION_RANGE_310,
  WAD,
} from "@gearbox-protocol/sdk";
import {
  iCreditFacadeV310Abi,
  iCreditManagerV310Abi,
  iPoolV310Abi,
} from "@gearbox-protocol/sdk/abi/310/generated";
import { replaceStorage } from "@gearbox-protocol/sdk/dev";
import {
  BaseError,
  decodeFunctionData,
  type SimulateContractReturnType,
} from "viem";
import type {
  FullLiquidatorSchema,
  LiqduiatorConfig,
} from "../../config/index.js";
import { DI } from "../../di.js";
import { errorAbis, isRevertedWith } from "../../errors/index.js";
import { type ILogger, Logger } from "../../log/index.js";
import type Client from "../Client.js";
import AccountHelper from "./AccountHelper.js";
import type {
  FullLiquidationPreview,
  ILiquidationStrategy,
  MakeLiquidatableResult,
} from "./types.js";

export default class LiquidationStrategyFull
  extends AccountHelper
  implements ILiquidationStrategy<FullLiquidationPreview>
{
  @DI.Inject(DI.CreditAccountService)
  creditAccountService!: ICreditAccountsService;

  @DI.Inject(DI.Config)
  config!: LiqduiatorConfig<FullLiquidatorSchema>;

  @DI.Inject(DI.Client)
  client!: Client;

  @Logger("FullStrategy")
  logger!: ILogger;

  public name: string;
  #applyLossPolicy: boolean;

  constructor(name = "full", applyLossPolicy = false) {
    super();
    this.name = name;
    this.#applyLossPolicy = applyLossPolicy;
  }

  public async launch(): Promise<void> {}

  public async syncState(_blockNumber: bigint): Promise<void> {}

  public async makeLiquidatable(
    ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult> {
    if (!this.#applyLossPolicy) {
      return { account: ca };
    }
    const { totalValue, debt, accruedInterest } = ca;
    if (!this.checkAccountVersion(ca, VERSION_RANGE_310)) {
      throw new Error("loss policy only works for v310 accounts");
    }

    // Induce bad debt on account
    // see hasBadDebt for the formula
    const cs = this.sdk.marketRegister.findCreditManager(ca.creditManager);
    const discount = BigInt(cs.creditManager.liquidationDiscount);
    let increaseBy =
      (totalValue * discount) / PERCENTAGE_FACTOR - accruedInterest - debt;
    if (increaseBy < 0n) {
      // already has bad debt, nothing to do
      return { account: ca };
    }
    increaseBy = (105n * increaseBy) / 100n;
    const newDebt = debt + increaseBy;

    const by = this.sdk.tokensMeta.formatBN(cs.underlying, increaseBy, {
      symbol: true,
    });
    const to = this.sdk.tokensMeta.formatBN(cs.underlying, newDebt, {
      symbol: true,
    });
    this.logger.debug(`artificially increasing debt by ${by} to ${to}`);
    const snapshotId = await this.client.anvil.snapshot();

    await this.#setDebt(ca, increaseBy, newDebt);
    const account = await this.creditAccountService.getCreditAccountData(
      ca.creditAccount,
    );
    if (!account || !this.hasBadDebt(account)) {
      throw new Error("could not induce bad debt");
    }

    return {
      account,
      snapshotId,
    };
  }

  async #setDebt(
    ca_: CreditAccountData,
    increaseBy: bigint,
    newDebt: bigint,
  ): Promise<void> {
    const { creditAccount, creditManager } = ca_;
    const { pool } = this.sdk.marketRegister.findByCreditManager(creditManager);
    await replaceStorage(this.client.anvil, {
      address: creditManager,
      abi: iCreditManagerV310Abi,
      functionName: "creditAccountInfo",
      args: [creditAccount],
      value: newDebt,
      slotMatch: (readVal, newVal) => readVal[0] === newVal,
    });
    const newTotalBorrowed = pool.pool.totalBorrowed + increaseBy;
    await replaceStorage(this.client.anvil, {
      address: pool.pool.address,
      abi: iPoolV310Abi,
      functionName: "totalBorrowed",
      args: [],
      value: newTotalBorrowed,
      slotMatch: (readVal, newVal) => readVal === newVal,
    });
    const newManagerBorrowed =
      pool.pool.creditManagerDebtParams.mustGet(creditManager).borrowed +
      increaseBy;
    await replaceStorage(this.client.anvil, {
      address: pool.pool.address,
      abi: iPoolV310Abi,
      functionName: "creditManagerBorrowed",
      args: [creditManager],
      value: newManagerBorrowed,
      slotMatch: (readVal, newVal) => readVal === newVal,
    });
  }

  public isApplicable(ca: CreditAccountData): boolean {
    if (
      this.#applyLossPolicy &&
      (!this.checkAccountVersion(ca, VERSION_RANGE_310) || !this.hasBadDebt(ca))
    ) {
      return false;
    }
    return true;
  }

  public async preview(ca: CreditAccountData): Promise<FullLiquidationPreview> {
    if (this.#applyLossPolicy && !this.hasBadDebt(ca)) {
      throw new Error("cannot apply loss policy: account has no bad debt");
    }
    try {
      const isV310 = this.checkAccountVersion(ca, VERSION_RANGE_310);
      const ignoreReservePrices = !this.config.updateReservePrices && isV310;
      const { tx, routerCloseResult, calls } =
        await this.creditAccountService.fullyLiquidate({
          account: ca,
          to: this.client.address,
          slippage: BigInt(this.config.slippage),
          keepAssets: this.config.keepAssets,
          ignoreReservePrices,
          applyLossPolicy: this.#applyLossPolicy,
        });
      return { ...routerCloseResult, calls, rawTx: tx };
    } catch (e) {
      throw new BaseError("cant preview full liquidation", {
        cause: e as Error,
      });
    }
  }

  public async simulate(
    account: CreditAccountData,
    preview: FullLiquidationPreview,
  ): Promise<SimulateContractReturnType<unknown[], any, any>> {
    const { args } = decodeFunctionData({
      abi: iCreditFacadeV310Abi,
      data: preview.rawTx.callData,
    });
    try {
      const result = await this.client.pub.simulateContract({
        account: this.client.account,
        abi: [...iCreditFacadeV310Abi, ...errorAbis],
        address: account.creditFacade,
        functionName: "liquidateCreditAccount",
        args: args as any,
      });
      return result as unknown as SimulateContractReturnType<
        unknown[],
        any,
        any
      >;
    } catch (e) {
      // in optimistic mode, it's possible to encounter accounts with underlying only and HF > 0
      if (this.config.optimistic) {
        if (
          account.healthFactor > WAD &&
          isRevertedWith(e as Error, "0x234b893b") // CreditAccountNotLiquidatableException())
        ) {
          throw new Error("warning: credit account is not liquidatable", {
            cause: e,
          });
        } else if (isRevertedWith(e as Error, "0x6b8c2b8c")) {
          // CreditAccountNotLiquidatableWithLossException()
          throw new Error(
            "warning: credit account is not liquidatable with loss",
            {
              cause: e,
            },
          );
        }
      }
      throw e;
    }
  }

  protected get sdk(): GearboxSDK {
    return this.creditAccountService.sdk;
  }
}
