import {
  type CreditAccountData,
  type OnchainSDK,
  WAD,
} from "@gearbox-protocol/sdk";
import { iCreditFacadeV310Abi } from "@gearbox-protocol/sdk/abi/310/generated";
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

export default abstract class LiquidationStrategyFullBase
  extends AccountHelper
  implements ILiquidationStrategy<FullLiquidationPreview>
{
  @DI.Inject(DI.SDK)
  sdk!: OnchainSDK;

  @DI.Inject(DI.Config)
  config!: LiqduiatorConfig<FullLiquidatorSchema>;

  @DI.Inject(DI.Client)
  client!: Client;

  @Logger("FullStrategy")
  logger!: ILogger;

  public readonly name: string;

  protected abstract readonly applyLossPolicy: boolean;

  constructor(name: string) {
    super();
    this.name = name;
  }

  public async launch(): Promise<void> {}

  public async syncState(_blockNumber: bigint): Promise<void> {}

  public abstract isApplicable(
    ca: CreditAccountData,
    optimistic: boolean,
  ): boolean;

  public abstract makeLiquidatable(
    ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult>;

  public async preview(ca: CreditAccountData): Promise<FullLiquidationPreview> {
    try {
      const ignoreReservePrices = !this.config.updateReservePrices;
      const cm = this.sdk.marketRegister.findCreditManager(ca.creditManager);
      const debtOnly =
        this.config.debtPolicy === "debt-only" ||
        (this.config.debtPolicy === "debt-expired" && cm.isExpired);
      const { tx, routerCloseResult, calls } =
        await this.sdk.accounts.fullyLiquidate({
          account: ca,
          to: this.client.address,
          slippage: BigInt(this.config.slippage),
          keepAssets: this.config.keepAssets,
          ignoreReservePrices,
          applyLossPolicy: this.applyLossPolicy,
          debtOnly,
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
}
