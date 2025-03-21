import { iPartialLiquidatorAbi } from "@gearbox-protocol/liquidator-v2-contracts/abi";
import type { CreditAccountData } from "@gearbox-protocol/sdk";
import { ADDRESS_0X0, AP_ROUTER, formatBN } from "@gearbox-protocol/sdk";
import {
  calcLiquidatableLTs,
  createAnvilClient,
  setLTs,
} from "@gearbox-protocol/sdk/dev";
import type { Address, SimulateContractReturnType } from "viem";

import { exceptionsAbis } from "../../data/index.js";
import AAVELiquidatorContract from "./AAVELiquidatorContract.js";
import GHOLiquidatorContract from "./GHOLiquidatorContract.js";
import type PartialLiquidatorContract from "./PartialLiquidatorContract.js";
import SingularFullLiquidator from "./SingularFullLiquidator.js";
import SingularLiquidator from "./SingularLiquidator.js";
import type {
  MakeLiquidatableResult,
  PartialLiquidationPreview,
  PartialLiquidationPreviewWithFallback,
} from "./types.js";

// currently there is no reliable way to get this from sdk
const LEGACY_PL_BOT: Address = "0x0f06c2bD612Ee7D52d4bC76Ce3BD7E95247AF2a9";
const NEXO_PL_BOT: Address = "0xc82020f1922AE56CCF25d5F2E2d6155E44583ef9";

export default class SingularPartialLiquidator extends SingularLiquidator<PartialLiquidationPreviewWithFallback> {
  protected readonly name = "partial";
  protected readonly adverb = "partially";

  /**
   * mapping of credit manager address to deployed partial liquidator
   */
  #liquidatorForCM: Record<Address, PartialLiquidatorContract> = {};
  #fallback?: SingularFullLiquidator;

  public async launch(asFallback?: boolean): Promise<void> {
    await super.launch(asFallback);

    if (this.config.partialFallback && !asFallback) {
      this.#fallback = new SingularFullLiquidator();
      this.logger.debug("launching full liquidator as fallback");
      await this.#fallback.launch(true);
    }

    const [router] = this.sdk.addressProvider.getLatestVersion(AP_ROUTER);

    const aaveLiquidator = new AAVELiquidatorContract(
      "AAVE Partial Liquidator",
      router,
      LEGACY_PL_BOT,
      this.config.aavePartialLiquidatorAddress,
    );
    const nexoLiquidator = new AAVELiquidatorContract(
      "AAVE Nexo Partial Liquidator",
      router,
      NEXO_PL_BOT,
      this.config.nexoPartialLiquidatorAddress,
    );
    const ghoLiquidator = new GHOLiquidatorContract(
      router,
      LEGACY_PL_BOT,
      "GHO",
    );
    const dolaLiquidator = new GHOLiquidatorContract(
      router,
      LEGACY_PL_BOT,
      "DOLA",
    );
    // safe to use 0x0 because none of underlyings is 0x0, so no cms will be added
    const GHO =
      this.creditAccountService.sdk.tokensMeta.findBySymbol("GHO")?.addr ??
      ADDRESS_0X0;
    const DOLA =
      this.creditAccountService.sdk.tokensMeta.findBySymbol("DOLA")?.addr ??
      ADDRESS_0X0;

    for (const cm of this.sdk.marketRegister.creditManagers) {
      switch (cm.underlying) {
        case GHO: {
          ghoLiquidator.addCreditManager(cm);
          this.#liquidatorForCM[cm.creditManager.address] = ghoLiquidator;
          break;
        }
        case DOLA: {
          dolaLiquidator.addCreditManager(cm);
          this.#liquidatorForCM[cm.creditManager.address] = dolaLiquidator;
          break;
        }
        default: {
          if (cm.name.toLowerCase().includes("nexo")) {
            nexoLiquidator.addCreditManager(cm);
            this.#liquidatorForCM[cm.creditManager.address] = nexoLiquidator;
          } else {
            aaveLiquidator.addCreditManager(cm);
            this.#liquidatorForCM[cm.creditManager.address] = aaveLiquidator;
          }
        }
      }
    }

    let expectedEnv: Record<string, string> = {};
    for (const contract of [
      aaveLiquidator,
      nexoLiquidator,
      ghoLiquidator,
      dolaLiquidator,
    ]) {
      if (!contract.isSupported) {
        this.logger.info(
          `${contract.name} is not supported on ${this.config.network}`,
        );
        continue;
      }
      await contract.deploy();
      await contract.configure();
      expectedEnv = {
        ...expectedEnv,
        ...Object.fromEntries([contract.envVariable]),
      };
    }
    this.logger.info(expectedEnv, "expected env");
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
    const newLTs = await calcLiquidatableLTs(this.sdk, ca, 9990n, logger);
    const snapshotId = await this.client.anvil.snapshot();
    const anvil = createAnvilClient({
      chain: this.sdk.provider.chain,
      transport: this.sdk.provider.transport,
    });

    await setLTs(anvil, cm.creditManager, newLTs, logger);
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
        hfNew: Number(updCa.healthFactor),
        ltChanges: Object.fromEntries(
          Object.entries(newLTs).map(([t, newLT]) => [
            t,
            [
              cm.creditManager.liquidationThresholds.mustGet(t as Address),
              newLT,
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
    const liquidatorAddr = this.liquidatorForCA(ca);
    if (!liquidatorAddr) {
      throw new Error(
        `no partial liquidator contract found for account ${ca.creditAccount} in ${cm.name}`,
      );
    }
    const {
      result: [
        tokenOut,
        optimalAmount,
        repaidAmount,
        flashLoanAmount,
        isOptimalRepayable,
      ],
    } = await this.client.pub.simulateContract({
      account: this.client.account,
      abi: [...iPartialLiquidatorAbi, ...exceptionsAbis],
      address: liquidatorAddr,
      functionName: "getOptimalLiquidation",
      args: [ca.creditAccount, 10100n, priceUpdates as any],
    });
    const [symb, decimals, uSymb, uDec] = [
      this.sdk.tokensMeta.symbol(tokenOut),
      this.sdk.tokensMeta.decimals(tokenOut),
      this.sdk.tokensMeta.symbol(cm.underlying),
      this.sdk.tokensMeta.decimals(cm.underlying),
    ];
    logger.debug(
      {
        tokenOut: `${symb} (${tokenOut})`,
        optimalAmount:
          formatBN(optimalAmount, decimals) + ` ${symb} (${optimalAmount})`,
        flashLoanAmount:
          formatBN(flashLoanAmount, uDec) + ` ${uSymb} (${flashLoanAmount})`,
        repaidAmount:
          formatBN(repaidAmount, uDec) + ` ${uSymb} (${repaidAmount})`,
        isOptimalRepayable,
      },
      "found optimal liquidation",
    );
    const connectors = this.sdk.router.getAvailableConnectors(
      cm.creditManager.collateralTokens,
    );

    try {
      const { result: preview } = await this.client.pub.simulateContract({
        account: this.client.account,
        address: liquidatorAddr,
        abi: [...iPartialLiquidatorAbi, ...exceptionsAbis],
        functionName: "previewPartialLiquidation",
        args: [
          ca.creditManager,
          ca.creditAccount,
          tokenOut,
          optimalAmount,
          flashLoanAmount,
          priceUpdates,
          connectors,
          BigInt(this.config.slippage),
        ],
      });
      if (preview.profit < 0n) {
        if (isOptimalRepayable) {
          throw new Error("optimal liquidation is not profitable or errored");
        } else {
          throw new Error(
            "warning: cannot liquidate while remaining within borrowing limits",
          );
        }
      }
      return {
        assetOut: tokenOut as Address,
        amountOut: optimalAmount,
        flashLoanAmount,
        priceUpdates,
        calls: preview.calls.map(c => ({
          callData: c.callData,
          target: c.target,
        })),
        underlyingBalance: preview.profit,
        skipOnFailure: !isOptimalRepayable,
      };
    } catch (e) {
      if (!isOptimalRepayable) {
        throw new Error(`warning: ${e}`);
      }
      throw e;
    }
  }

  public async simulate(
    account: CreditAccountData,
    preview: PartialLiquidationPreviewWithFallback,
  ): Promise<SimulateContractReturnType> {
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
  ): Promise<SimulateContractReturnType> {
    const liquidatorAddr = this.liquidatorForCA(account);
    if (!liquidatorAddr) {
      throw new Error(
        `no partial liquidator contract found for account ${account.creditAccount} in ${account.creditManager}`,
      );
    }
    return this.client.pub.simulateContract({
      account: this.client.account,
      address: liquidatorAddr,
      abi: [...iPartialLiquidatorAbi, ...exceptionsAbis],
      functionName: "partialLiquidateAndConvert",
      args: [
        account.creditManager,
        account.creditAccount,
        preview.assetOut,
        preview.amountOut,
        preview.flashLoanAmount,
        preview.priceUpdates,
        preview.calls,
      ],
    });
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
  private liquidatorForCA(ca: CreditAccountData): Address | undefined {
    const contract = this.#liquidatorForCM[ca.creditManager];
    return contract?.address;
  }
}
