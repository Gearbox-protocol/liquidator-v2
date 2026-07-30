import type {
  FullLiquidatorSchema,
  FullStrategyPreview,
  LiqduiatorConfig,
} from "@gearbox-protocol/liquidator-v2-config";
import {
  AP_TREASURY,
  type CreditAccountData,
  type OnchainSDK,
  WAD,
} from "@gearbox-protocol/sdk";
import { iCreditFacadeV310Abi } from "@gearbox-protocol/sdk/abi/310/generated";
import { type Address, BaseError, decodeFunctionData } from "viem";
import { DI } from "../../di.js";
import { errorAbis, isRevertedWith } from "../../errors/index.js";
import { type ILogger, Logger } from "../../log/index.js";
import type Client from "../Client.js";
import AccountHelper from "./AccountHelper.js";
import type {
  ILiquidationStrategy,
  LiquidationRequest,
  MakeLiquidatableResult,
} from "./types.js";
import { toLiquidationRequest } from "./types.js";

export default abstract class LiquidationStrategyFullBase<
    K extends "full" | "loss-policy",
  >
  extends AccountHelper
  implements ILiquidationStrategy<K>
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

  public abstract readonly kind: K;

  protected abstract readonly applyLossPolicy: boolean;

  constructor(name: string) {
    super();
    this.name = name;
  }

  public async launch(): Promise<void> {}

  public async syncState(_blockNumber: bigint): Promise<void> {}

  /**
   * Resolves the premium receiver as `config.premiumReceiver ?? TREASURY v0 ?? executor`.
   * Logs the chosen receiver and its source on every access.
   */
  public get premiumReceiver(): Address {
    if (this.config.premiumReceiver) {
      this.logger.debug(
        `premium receiver: ${this.config.premiumReceiver} (config)`,
      );
      return this.config.premiumReceiver;
    }
    try {
      const treasury = this.sdk.addressProvider.getAddress(AP_TREASURY, 0);
      if (treasury) {
        this.logger.debug(`premium receiver: ${treasury} (treasury v0)`);
        return treasury;
      }
    } catch {
      // TREASURY v0 not registered; fall through to executor
    }
    this.logger.debug(`premium receiver: ${this.client.address} (executor)`);
    return this.client.address;
  }

  public abstract isApplicable(
    ca: CreditAccountData,
    optimistic: boolean,
  ): boolean;

  public abstract makeLiquidatable(
    ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult<K>>;

  public async preview(
    ca: CreditAccountData,
  ): Promise<FullStrategyPreview<bigint>> {
    try {
      const ignoreReservePrices = !this.config.updateReservePrices;
      const cm = this.sdk.marketRegister.findCreditManager(ca.creditManager);
      const debtOnly =
        this.config.debtPolicy === "debt-only" ||
        (this.config.debtPolicy === "debt-expired" && cm.isExpired);
      const { tx, routerCloseResult, calls } =
        await this.sdk.accounts.fullyLiquidate({
          account: ca,
          to: this.premiumReceiver,
          slippage: BigInt(this.config.slippage),
          keepAssets: this.config.keepAssets,
          ignoreReservePrices,
          applyLossPolicy: this.applyLossPolicy,
          debtOnly,
        });
      return {
        routerAmount: routerCloseResult.underlyingBalance,
        minAmount: routerCloseResult.minAmount,
        calls,
        rawTx: tx,
      };
    } catch (e) {
      throw new BaseError("cant preview full liquidation", {
        cause: e as Error,
      });
    }
  }

  public async simulate(
    account: CreditAccountData,
    preview: FullStrategyPreview,
  ): Promise<LiquidationRequest> {
    const { args } = decodeFunctionData({
      abi: iCreditFacadeV310Abi,
      data: preview.rawTx.callData,
    });
    try {
      const { request } = await this.client.pub.simulateContract({
        account: this.client.account,
        abi: [...iCreditFacadeV310Abi, ...errorAbis],
        address: account.creditFacade,
        functionName: "liquidateCreditAccount",
        args: args as any,
      });
      return toLiquidationRequest(request);
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
