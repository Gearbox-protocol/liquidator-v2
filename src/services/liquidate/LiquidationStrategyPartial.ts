import {
  type CreditAccountData,
  type GearboxSDK,
  type ICreditAccountsService,
  VERSION_RANGE_310,
} from "@gearbox-protocol/sdk";
import {
  calcLiquidatableLTs,
  extendAnvilClient,
  setLTs,
} from "@gearbox-protocol/sdk/dev";
import type { Address, SimulateContractReturnType } from "viem";
import type {
  DeleverageLiquidatorSchema,
  LiqduiatorConfig,
  PartialLiquidatorSchema,
} from "../../config/index.js";
import { DI } from "../../di.js";
import { type ILogger, Logger } from "../../log/index.js";
import type Client from "../Client.js";
import AccountHelper from "./AccountHelper.js";
import {
  humanizeOptimalLiquidation,
  type IPartialLiquidatorContract,
  PartialContractsDeployer,
} from "./partial/index.js";
import type {
  ILiquidationStrategy,
  MakeLiquidatableResult,
  PartialLiquidationPreview,
} from "./types.js";

export default class LiquidationStrategyPartial
  extends AccountHelper
  implements ILiquidationStrategy<PartialLiquidationPreview>
{
  @DI.Inject(DI.CreditAccountService)
  creditAccountService!: ICreditAccountsService;

  @DI.Inject(DI.Config)
  config!: LiqduiatorConfig<
    PartialLiquidatorSchema | DeleverageLiquidatorSchema
  >;

  @DI.Inject(DI.Client)
  client!: Client;

  @Logger("PartialStrategy")
  logger!: ILogger;

  #deployer: PartialContractsDeployer;

  constructor() {
    super();
    this.#deployer = new PartialContractsDeployer(this.sdk);
  }

  public get name(): string {
    return "partial";
  }

  public async launch(): Promise<void> {
    await this.#deployer.syncState();
  }

  public async syncState(_blockNumber: bigint): Promise<void> {
    await this.#deployer.syncState();
  }

  public async makeLiquidatable(
    ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult> {
    if (!this.config.optimistic) {
      throw new Error("makeLiquidatable only works in optimistic mode");
    }
    if (ca.debt === 0n) {
      throw new Error("warning: zero-debt account");
    }
    this.#assertReserveFeeds(ca);
    if (!this.#liquidatorForCA(ca)) {
      throw new Error(
        "warning: account's credit manager is not registered in partial liquidator",
      );
    }
    const cm = this.sdk.marketRegister.findCreditManager(ca.creditManager);
    const newLTs = await calcLiquidatableLTs(
      this.sdk,
      ca,
      this.config.liquidationMode === "partial" ? 9990n : 10005n,
      this.logger,
    );
    const snapshotId = await this.client.anvil.snapshot();

    await setLTs(this.client.anvil, cm.state, newLTs, this.logger);
    const updCa = await this.creditAccountService.getCreditAccountData(
      ca.creditAccount,
    );
    if (!updCa) {
      throw new Error(`cannot find credit account ${ca.creditAccount}`);
    }
    this.logger.debug({
      hfNew: updCa.healthFactor.toString(),
      hfOld: ca.healthFactor.toString(),
    });
    return {
      snapshotId,
      partialLiquidationCondition: {
        hfNew: updCa.healthFactor,
        ltChanges: Object.fromEntries(
          Object.entries(newLTs).map(([t, newLT]) => [
            t,
            [
              BigInt(
                cm.creditManager.liquidationThresholds.mustGet(t as Address),
              ),
              BigInt(newLT),
            ],
          ]),
        ),
      },
    };
  }

  public async preview(
    ca: CreditAccountData,
  ): Promise<PartialLiquidationPreview> {
    const cm = this.sdk.marketRegister.findCreditManager(ca.creditManager);
    const isV310 = this.checkAccountVersion(ca, VERSION_RANGE_310);
    const ignoreReservePrices =
      isV310 &&
      !this.config.updateReservePrices &&
      this.config.liquidationMode !== "deleverage";
    const priceUpdates =
      await this.creditAccountService.getOnDemandPriceUpdates({
        creditManager: ca.creditManager,
        creditAccount: ca,
        ignoreReservePrices,
      });
    const liquidatorContract = this.#liquidatorForCA(ca);
    if (!liquidatorContract) {
      throw new Error(
        `no partial liquidator contract found for account ${ca.creditAccount} in ${cm.name}`,
      );
    }
    const optimalLiquidation = await liquidatorContract.getOptimalLiquidation(
      ca,
      priceUpdates,
    );
    this.logger.debug(
      humanizeOptimalLiquidation(cm, optimalLiquidation),
      "found optimal liquidation",
    );

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
        priceUpdates: priceUpdates.raw,
        calls: preview.calls.map(c => ({
          callData: c.callData,
          target: c.target,
        })),
        underlyingBalance: preview.profit,
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
    preview: PartialLiquidationPreview,
  ): Promise<SimulateContractReturnType<unknown[], any, any>> {
    const liquidator = this.#liquidatorForCA(account);
    if (!liquidator) {
      throw new Error(
        `no partial liquidator contract found for account ${account.creditAccount} in ${account.creditManager}`,
      );
    }
    return liquidator.partialLiquidateAndConvert(account, preview);
  }

  protected get sdk(): GearboxSDK {
    return this.creditAccountService.sdk;
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

  /**
   * Throws if account has non-dust tokens without reserve price feeds
   * @param ca
   */
  #assertReserveFeeds(ca: CreditAccountData): void {
    const market = this.sdk.marketRegister.findByCreditManager(
      ca.creditManager,
    );
    const feeds = market.priceOracle.reservePriceFeeds;
    for (const { token, balance } of ca.tokens) {
      if (token === ca.underlying) {
        continue;
      }
      if (balance > 10n && !feeds.has(token)) {
        throw new Error(
          "warning: account has tokens without reserve price feeds",
        );
      }
    }
  }
}
