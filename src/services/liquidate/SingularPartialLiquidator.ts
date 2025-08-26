import type { CreditAccountData } from "@gearbox-protocol/sdk";
import {
  calcLiquidatableLTs,
  createAnvilClient,
  setLTs,
} from "@gearbox-protocol/sdk/dev";
import type { Address, SimulateContractReturnType } from "viem";
import type {
  DeleverageLiquidatorSchema,
  PartialLiquidatorSchema,
} from "../../config/index.js";
import {
  humanizeOptimalLiquidation,
  type IPartialLiquidatorContract,
  PartialContractsDeployer,
} from "./partial/index.js";
import SingularFullLiquidator from "./SingularFullLiquidator.js";
import SingularLiquidator from "./SingularLiquidator.js";
import type {
  MakeLiquidatableResult,
  PartialLiquidationPreview,
  PartialLiquidationPreviewWithFallback,
} from "./types.js";

export default class SingularPartialLiquidator extends SingularLiquidator<
  PartialLiquidationPreviewWithFallback,
  PartialLiquidatorSchema | DeleverageLiquidatorSchema
> {
  protected readonly name = "partial";
  protected readonly adverb = "partially";

  #fallback?: SingularFullLiquidator;
  #deployer: PartialContractsDeployer;

  constructor() {
    super();
    this.#deployer = new PartialContractsDeployer(this.sdk);
  }

  public async launch(asFallback?: boolean): Promise<void> {
    await super.launch(asFallback);

    if (this.config.liquidationMode === "partial") {
      if (this.config.partialFallback && !asFallback) {
        this.#fallback = new SingularFullLiquidator();
        this.logger.debug("launching full liquidator as fallback");
        await this.#fallback.launch(true);
      } else {
        this.logger.debug("fallback to full mode disabled");
      }
    }

    await this.#deployer.syncState();
  }

  public override async syncState(_blockNumber: bigint): Promise<void> {
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
    if (!this.liquidatorForCA(ca)) {
      throw new Error(
        "warning: account's credit manager is not registered in partial liquidator",
      );
    }
    const logger = this.caLogger(ca);
    const cm = this.sdk.marketRegister.findCreditManager(ca.creditManager);
    const newLTs = await calcLiquidatableLTs(
      this.sdk,
      ca,
      this.config.liquidationMode === "partial" ? 9990n : 10005n,
      logger,
    );
    const snapshotId = await this.client.anvil.snapshot();
    const anvil = createAnvilClient({
      chain: this.sdk.provider.chain,
      transport: this.sdk.provider.transport,
    });

    await setLTs(anvil, cm.state, newLTs, logger);
    const updCa = await this.creditAccountService.getCreditAccountData(
      ca.creditAccount,
    );
    if (!updCa) {
      throw new Error(`cannot find credit account ${ca.creditAccount}`);
    }
    logger.debug({
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
  ): Promise<PartialLiquidationPreviewWithFallback> {
    const logger = this.caLogger(ca);
    try {
      const partial = await this.#preview(ca);
      return {
        ...partial,
        fallback: false,
      };
    } catch (e) {
      if (this.#fallback) {
        logger.debug(`partial preview failed: ${e}`);
        logger.debug("previewing with fallback liquidator");
        const result = await this.#fallback.preview(ca);
        return {
          ...result,
          fallback: true,
        };
      }
      throw e;
    }
  }

  async #preview(ca: CreditAccountData): Promise<PartialLiquidationPreview> {
    const logger = this.caLogger(ca);
    const cm = this.sdk.marketRegister.findCreditManager(ca.creditManager);
    const priceUpdates =
      await this.creditAccountService.getOnDemandPriceUpdates(
        ca.creditManager,
        ca,
        undefined,
      );
    const liquidatorContract = this.liquidatorForCA(ca);
    if (!liquidatorContract) {
      throw new Error(
        `no partial liquidator contract found for account ${ca.creditAccount} in ${cm.name}`,
      );
    }
    const optimalLiquidation = await liquidatorContract.getOptimalLiquidation(
      ca,
      priceUpdates,
    );
    logger.debug(
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
    preview: PartialLiquidationPreviewWithFallback,
  ): Promise<SimulateContractReturnType<unknown[], any, any>> {
    const logger = this.caLogger(account);
    if (preview.fallback) {
      if (!this.#fallback) {
        throw new Error("fallback liquidator is not launched");
      }
      logger.debug("simulating with fallback liquidator");
      return this.#fallback.simulate(account, preview);
    }
    return this.#simulate(account, preview);
  }

  async #simulate(
    account: CreditAccountData,
    preview: PartialLiquidationPreview,
  ): Promise<SimulateContractReturnType<unknown[], any, any>> {
    const liquidator = this.liquidatorForCA(account);
    if (!liquidator) {
      throw new Error(
        `no partial liquidator contract found for account ${account.creditAccount} in ${account.creditManager}`,
      );
    }
    return liquidator.partialLiquidateAndConvert(account, preview);
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

  /**
   * Depending on credit manager underlying token, different partial liquidator contract should be used
   * @param ca
   * @returns
   */
  private liquidatorForCA(
    ca: CreditAccountData,
  ): IPartialLiquidatorContract | undefined {
    return this.#deployer.getLiquidatorForCM(ca.creditManager);
  }
}
