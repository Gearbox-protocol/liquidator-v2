import type {
  CommonSchema,
  LiqduiatorConfig,
  PartialStrategyPreview,
} from "@gearbox-protocol/liquidator-v2-config";
import type {
  CreditAccountData,
  OnchainSDK,
} from "@gearbox-protocol/sdk/onchain";
import type { Address } from "viem";
import { DI } from "../../di.js";
import { type ILogger, Logger } from "../../log/index.js";
import type Client from "../Client.js";
import AccountHelper from "./AccountHelper.js";
import { type LoweredLTs, OptimisticLTs } from "./OptimisticLTs.js";
import {
  humanizeOptimalLiquidation,
  type IPartialLiquidatorContract,
  PartialContractsDeployer,
} from "./partial/index.js";
import type {
  ILiquidationStrategy,
  LiquidationRequest,
  MakeLiquidatableResult,
} from "./types.js";

/**
 * Shared logic for partial and deleverage strategies, generic over the kind so
 * that `makeLiquidatable` and `preview` stay aligned. Concrete leaves provide
 * `kind`, `name` and `makeLiquidatable`.
 */
export default abstract class LiquidationStrategyPartialBase<
    K extends "partial" | "deleverage",
  >
  extends AccountHelper
  implements ILiquidationStrategy<K>
{
  @DI.Inject(DI.SDK)
  sdk!: OnchainSDK;

  @DI.Inject(DI.Config)
  config!: LiqduiatorConfig<CommonSchema>;

  @DI.Inject(DI.Client)
  client!: Client;

  @Logger("PartialStrategy")
  logger!: ILogger;

  public abstract readonly kind: K;

  public abstract get name(): string;

  public get premiumReceiver(): Address {
    return this.client.address;
  }

  #deployer: PartialContractsDeployer;
  #lts = new OptimisticLTs();

  constructor() {
    super();
    this.#deployer = new PartialContractsDeployer(this.sdk);
  }

  public async launch(): Promise<void> {
    await this.#deployer.syncState();
  }

  public async syncState(_blockNumber: bigint): Promise<void> {
    await this.#deployer.syncState();
  }

  public isApplicable(_ca: CreditAccountData, _optimistic: boolean): boolean {
    return true;
  }

  public abstract makeLiquidatable(
    ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult<K>>;

  /**
   * Lowers liquidation thresholds (and snapshots) to make the account partially
   * liquidatable. Shared core used by both partial and deleverage.
   */
  protected async makePartialLiquidatable(
    ca: CreditAccountData,
  ): Promise<LoweredLTs> {
    if (!this.#liquidatorForCA(ca)) {
      throw new Error(
        "warning: account's credit manager is not registered in partial liquidator",
      );
    }
    return this.#lts.lower(ca, this.optimisticHF(ca));
  }

  public async preview(
    ca: CreditAccountData,
  ): Promise<PartialStrategyPreview<bigint>> {
    this.#lts.apply(ca);
    try {
      return await this.#preview(ca);
    } finally {
      this.#lts.revert(ca);
    }
  }

  async #preview(
    ca: CreditAccountData,
  ): Promise<PartialStrategyPreview<bigint>> {
    const cm = this.sdk.marketRegister.findCreditManager(ca.creditManager);
    const priceUpdates = await this.sdk.accounts.getOnDemandPriceUpdates(
      ca,
      this.ignoreReservePrices(ca),
    );
    const liquidatorContract = this.#liquidatorForCA(ca);
    if (!liquidatorContract) {
      throw new Error(
        `no partial liquidator contract found for account ${ca.creditAccount} in ${cm.name}`,
      );
    }
    const optimalLiquidation = liquidatorContract.getOptimalLiquidation(ca);
    this.logger.debug(
      humanizeOptimalLiquidation(cm, optimalLiquidation),
      "found optimal liquidation",
    );
    if (optimalLiquidation.optimalAmount === 0n) {
      throw new Error(
        "warning: optimal liquidation amount is zero, account is either healthy enough or its debt is below min debt",
      );
    }

    try {
      const preview = await liquidatorContract.previewPartialLiquidation(
        ca,
        cm,
        optimalLiquidation,
        priceUpdates,
      );
      if (preview.profit < 0n) {
        if (optimalLiquidation.isOptimalRepayable) {
          throw new Error("optimal liquidation is not profitable or errored");
        } else {
          throw new Error(
            "warning: cannot liquidate while remaining within borrowing limits",
          );
        }
      }
      return {
        assetOut: optimalLiquidation.tokenOut,
        amountOut: optimalLiquidation.optimalAmount,
        flashLoanAmount: optimalLiquidation.flashLoanAmount,
        priceUpdates,
        calls: preview.calls.map(c => ({
          callData: c.callData,
          target: c.target,
        })),
        previewedProfit: preview.profit,
        skipOnFailure: !optimalLiquidation.isOptimalRepayable,
      };
    } catch (e) {
      if (!optimalLiquidation.isOptimalRepayable) {
        throw new Error(`warning: ${e}`);
      }
      throw e;
    }
  }

  public async simulate(
    account: CreditAccountData,
    preview: PartialStrategyPreview<bigint>,
  ): Promise<LiquidationRequest> {
    const liquidator = this.#liquidatorForCA(account);
    if (!liquidator) {
      throw new Error(
        `no partial liquidator contract found for account ${account.creditAccount} in ${account.creditManager}`,
      );
    }
    return liquidator.partialLiquidateAndConvert(account, preview);
  }

  /**
   * Depending on credit manager underlying token, different partial liquidator contract should be used
   * @param ca
   * @returns
   */
  #liquidatorForCA(
    ca: CreditAccountData,
  ): IPartialLiquidatorContract | undefined {
    return this.#deployer.getLiquidatorForCM(ca.creditManager);
  }

  protected ignoreReservePrices(_ca: CreditAccountData): boolean {
    return !this.config.updateReservePrices;
  }

  protected optimisticHF(_ca: CreditAccountData): bigint {
    return 9990n;
  }
}
