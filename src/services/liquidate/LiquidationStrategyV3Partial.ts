import type {
  ILiquidator,
  IPriceHelper,
  TokenPriceInfoStructOutput,
} from "@gearbox-protocol/liquidator-v2-contracts";
import {
  AaveFLTaker__factory,
  ILiquidator__factory,
  IPriceHelper__factory,
  Liquidator__factory,
  PriceHelper__factory,
} from "@gearbox-protocol/liquidator-v2-contracts";
import type { ExcludeArrayProps } from "@gearbox-protocol/sdk-gov";
import {
  ADDRESS_0X0,
  contractsByNetwork,
  formatBN,
  getDecimals,
  getTokenSymbolOrAddress,
  PERCENTAGE_FACTOR,
  tokenSymbolByAddress,
  WAD,
} from "@gearbox-protocol/sdk-gov";
import {
  IACL__factory,
  ICreditConfiguratorV3__factory,
  ICreditManagerV3__factory,
} from "@gearbox-protocol/types/v3";
import type { JsonRpcProvider, TransactionReceipt, Wallet } from "ethers";
import { Service } from "typedi";

import { Logger, type LoggerInterface } from "../../log";
import type {
  CreditAccountData,
  CreditManagerData,
} from "../../utils/ethers-6-temp";
import { impersonate, stopImpersonate } from "../../utils/impersonate";
import AbstractLiquidationStrategyV3 from "./AbstractLiquidationStrategyV3";
import type {
  ILiquidationStrategy,
  MakeLiquidatableResult,
  PartialLiquidationPreview,
} from "./types";

interface TokenBalance extends ExcludeArrayProps<TokenPriceInfoStructOutput> {
  /**
   * Balance in underlying * liquidationThreshold
   */
  weightedBalance: bigint;
}

@Service()
export default class LiquidationStrategyV3Partial
  extends AbstractLiquidationStrategyV3
  implements ILiquidationStrategy<PartialLiquidationPreview>
{
  public readonly name = "partial";
  public readonly adverb = "partially";

  @Logger("LiquidationStrategyV3Partial")
  logger: LoggerInterface;

  #partialLiquidator?: ILiquidator;
  #priceHelper?: IPriceHelper;
  #configuratorAddr?: string;
  #registeredCMs: Record<string, boolean> = {};

  public async launch(): Promise<void> {
    await super.launch();

    const router = await this.addressProvider.findService("ROUTER", 300);
    const bot = await this.addressProvider.findService(
      "PARTIAL_LIQUIDATION_BOT",
      300,
    );
    const aavePool =
      contractsByNetwork[this.addressProvider.network].AAVE_V3_LENDING_POOL;
    this.logger.debug(`router=${router}, bot=${bot}, aave pool = ${aavePool}`);

    this.#partialLiquidator = await this.#deployPartialLiquidator(
      this.executor.wallet,
      router,
      bot,
      aavePool,
    );

    this.#priceHelper = await this.#deployPriceHelper(this.executor.wallet);

    await this.#configurePartialLiquidator(router, bot);
  }

  public async makeLiquidatable(
    ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult> {
    if (!this.config.optimistic) {
      throw new Error("makeLiquidatable only works in optimistic mode");
    }
    if (ca.borrowedAmount === 0n) {
      throw new Error("zero-debt account");
    }
    if (!this.oracle.checkReserveFeeds(ca)) {
      throw new Error("account has tokens without reserve price feeds");
    }
    if (!this.#registeredCMs[ca.creditManager.toLowerCase()]) {
      throw new Error(
        "account's credit manager is not registered in partial liquidator",
      );
    }
    const logger = this.#caLogger(ca);
    const cm = await this.getCreditManagerData(ca.creditManager);

    const ltChanges = await this.#calcNewLTs(ca);
    const snapshotId = await (this.executor.provider as JsonRpcProvider).send(
      "evm_snapshot",
      [],
    );

    await this.#setNewLTs(ca, cm, ltChanges);
    const updCa = await this.updateCreditAccountData(ca);
    logger.debug({
      hfNew: updCa.healthFactor.toString(),
      hfOld: ca.healthFactor.toString(),
      isSuccessful: updCa.isSuccessful,
    });
    return {
      snapshotId,
      partialLiquidationCondition: {
        hfNew: Number(updCa.healthFactor),
        ltChanges,
      },
    };
  }

  public async preview(
    ca: CreditAccountData,
  ): Promise<PartialLiquidationPreview> {
    const logger = this.#caLogger(ca);
    const cm = await this.getCreditManagerData(ca.creditManager);
    const priceUpdates = await this.redstone.liquidationPreviewUpdates(ca);
    const {
      tokenOut,
      optimalAmount,
      flashLoanAmount,
      repaidAmount,
      isOptimalRepayable,
    } = await this.partialLiquidator.getOptimalLiquidation.staticCall(
      ca.addr,
      10100,
      priceUpdates,
    );
    const [symb, decimals, uSymb, uDec] = [
      getTokenSymbolOrAddress(tokenOut),
      getDecimals(tokenOut),
      getTokenSymbolOrAddress(cm.underlyingToken),
      getDecimals(cm.underlyingToken),
    ];
    logger.debug(
      {
        tokenOut: `${symb} (${tokenOut})`,
        optimalAmount: formatBN(optimalAmount, decimals) + " " + symb,
        flashLoanAmount: formatBN(flashLoanAmount, uDec) + " " + uSymb,
        repaidAmount: formatBN(repaidAmount, uDec) + " " + uSymb,
        isOptimalRepayable,
      },
      "found optimal liquidation",
    );
    const connectors = this.pathFinder.getAvailableConnectors(ca.allBalances);

    const preview =
      await this.partialLiquidator.previewPartialLiquidation.staticCall(
        ca.creditManager,
        ca.addr,
        tokenOut,
        optimalAmount,
        flashLoanAmount,
        priceUpdates,
        connectors,
        this.config.slippage,
      );
    if (preview.profit < 0n) {
      if (isOptimalRepayable) {
        throw new Error("optimal liquidation is not profitable or errored");
      } else {
        throw new Error("cannot liquidate with remaining debt surplus");
      }
    }
    return {
      assetOut: tokenOut,
      amountOut: optimalAmount,
      flashLoanAmount,
      priceUpdates,
      calls: preview.calls.map(c => ({
        callData: c.callData,
        target: c.target,
      })),
      underlyingBalance: preview.profit,
    };
  }

  public async estimate(
    account: CreditAccountData,
    preview: PartialLiquidationPreview,
  ): Promise<bigint> {
    return this.partialLiquidator.partialLiquidateAndConvert.estimateGas(
      account.creditManager,
      account.addr,
      preview.assetOut,
      preview.amountOut,
      preview.flashLoanAmount,
      preview.priceUpdates,
      preview.calls,
    );
  }

  public async liquidate(
    account: CreditAccountData,
    preview: PartialLiquidationPreview,
    gasLimit?: bigint,
  ): Promise<TransactionReceipt> {
    const txData =
      await this.partialLiquidator.partialLiquidateAndConvert.populateTransaction(
        account.creditManager,
        account.addr,
        preview.assetOut,
        preview.amountOut,
        preview.flashLoanAmount,
        preview.priceUpdates,
        preview.calls,
        gasLimit ? { gasLimit } : {},
      );
    return this.executor.sendPrivate(txData);
  }

  async #prepareAccountTokens(ca: CreditAccountData): Promise<TokenBalance[]> {
    const priceUpdates = await this.redstone.dataCompressorUpdates(ca);
    // this helper contract fetches prices while trying to ignore updatable price feeds
    // prices here are not critical, as they're used for sorting and estimation
    const tokens = await this.priceHelper.previewTokens.staticCall(
      ca.addr,
      priceUpdates,
    );
    // Sort by weighted value descending, but underlying token comes last
    return tokens
      .map(
        (t): TokenBalance => ({
          token: t.token.toLowerCase(),
          balance: t.balance,
          balanceInUnderlying: t.balanceInUnderlying,
          liquidationThreshold: t.liquidationThreshold,
          weightedBalance:
            (t.balanceInUnderlying * t.liquidationThreshold) /
            PERCENTAGE_FACTOR,
        }),
      )
      .sort((a, b) => {
        if (a.token === ca.underlyingToken) return 1;
        if (b.token === ca.underlyingToken) return -1;
        return b.weightedBalance > a.weightedBalance ? 1 : -1;
      });
  }

  /**
   * Given credit accounts, calculates new liquidation thresholds that needs to be set to drop account health factor a bit to make it eligible for partial liquidation
   * @param ca
   */
  async #calcNewLTs(
    ca: CreditAccountData,
    factor = 9990n,
  ): Promise<Record<string, [ltOld: bigint, ltNew: bigint]>> {
    const logger = this.#caLogger(ca);
    const balances = await this.#prepareAccountTokens(ca);
    balances.forEach(b => {
      logger.debug(
        `${tokenSymbolByAddress[b.token]}: ${formatBN(b.balance, getDecimals(b.token))} ${tokenSymbolByAddress[b.token]} == ${formatBN(b.balanceInUnderlying, getDecimals(ca.underlyingToken))} (weighted ${formatBN(b.weightedBalance, getDecimals(ca.underlyingToken))}) ${tokenSymbolByAddress[ca.underlyingToken]}`,
      );
    });
    // const snapshotId = await (
    // this.executor.provider as providers.JsonRpcProvider
    // ).send("evm_snapshot", []);

    // LTnew = LT * k, where
    //
    //        totalDebt - B_underlying * LT_underlying
    // k = -------------------------------------------------------------
    //                    sum(p * b* LT)
    let divisor = 0n;
    let dividend =
      (factor * ca.borrowedAmountPlusInterestAndFees) / PERCENTAGE_FACTOR; // TODO: USDT fee
    for (const { token, weightedBalance } of balances) {
      if (token === ca.underlyingToken) {
        dividend -= weightedBalance;
      } else {
        divisor += weightedBalance;
      }
    }
    if (divisor === 0n) {
      throw new Error("assets have zero weighted value in underlying");
    }
    if (dividend <= 0n) {
      throw new Error(`account balance in underlying covers debt`);
    }
    const k = (WAD * dividend) / divisor;

    const result: Record<string, [bigint, bigint]> = {};
    const ltChangesHuman: Record<string, string> = {};
    for (const { token, liquidationThreshold: oldLT } of balances) {
      if (token !== ca.underlyingToken) {
        const newLT = (oldLT * k) / WAD;
        result[token] = [oldLT, newLT];
        ltChangesHuman[tokenSymbolByAddress[token]] = `${oldLT} => ${newLT}`;
      }
    }
    logger.debug(
      ltChangesHuman,
      "need to change LTs to enable partial liquidation",
    );
    return result;
  }

  async #setNewLTs(
    ca: CreditAccountData,
    cm: CreditManagerData,
    ltChanges: Record<string, [bigint, bigint]>,
  ): Promise<void> {
    const logger = this.#caLogger(ca);
    const configuratorAddr = await this.getConfiguratorAddr();
    const impConfiurator = await impersonate(
      this.executor.provider,
      configuratorAddr,
    );
    const cc = ICreditConfiguratorV3__factory.connect(
      cm.creditConfigurator,
      impConfiurator,
    );
    const mgr = ICreditManagerV3__factory.connect(
      cm.address,
      this.executor.provider,
    );
    for (const [t, [_, lt]] of Object.entries(ltChanges)) {
      const tx = await cc.setLiquidationThreshold(t, lt);
      await this.executor.mine(tx);
      const newLT = await mgr.liquidationThresholds(t);
      logger.debug(`set LT of ${tokenSymbolByAddress[t]} to ${lt}: ${newLT}`);
    }
    await stopImpersonate(this.executor.provider, configuratorAddr);
  }

  async #deployPartialLiquidator(
    executor: Wallet,
    router: string,
    bot: string,
    aavePool: string,
  ): Promise<ILiquidator> {
    let partialLiquidatorAddress = this.config.partialLiquidatorAddress;
    if (!partialLiquidatorAddress) {
      this.logger.debug("deploying partial liquidator");

      const aaveFlTakerFactory = new AaveFLTaker__factory(executor);
      const aaveFlTaker = await aaveFlTakerFactory.deploy(aavePool);
      await aaveFlTaker.waitForDeployment();
      this.logger.debug(
        `deployed AaveFLTaker at ${aaveFlTaker.target} in tx ${aaveFlTaker.deploymentTransaction()?.hash}`,
      );

      const liquidatorFactory = new Liquidator__factory(executor);
      const liquidator = await liquidatorFactory.deploy(
        router,
        bot,
        aavePool,
        aaveFlTaker.target,
      );
      await liquidator.waitForDeployment();
      this.logger.debug(
        `deployed Liquidator ${liquidator.target} in tx ${liquidator.deploymentTransaction()?.hash}`,
      );

      const tx = await aaveFlTaker.setAllowedFLReceiver(
        liquidator.target,
        true,
      );
      await tx.wait();
      this.logger.debug(
        `set allowed flashloan receiver on FLTaker ${aaveFlTaker.target} to ${liquidator.target} in tx ${tx.hash}`,
      );

      partialLiquidatorAddress = liquidator.target as string;
    }
    this.logger.info(
      `partial liquidator contract addesss: ${partialLiquidatorAddress}`,
    );
    return ILiquidator__factory.connect(partialLiquidatorAddress, executor);
  }

  async #deployPriceHelper(executor: Wallet): Promise<IPriceHelper> {
    let priceHelperAddress = this.config.priceHelperAddress;
    if (!priceHelperAddress) {
      this.logger.debug("deploying price helper");

      const factory = new PriceHelper__factory(executor);
      const priceHelper = await factory.deploy();
      await priceHelper.waitForDeployment();
      this.logger.debug(
        `deployed PriceHelper at ${priceHelper.target} in tx ${priceHelper.deploymentTransaction()?.hash}`,
      );
      priceHelperAddress = priceHelper.target as string;
    }
    this.logger.info(`price helper contract addesss: ${priceHelperAddress}`);
    return IPriceHelper__factory.connect(priceHelperAddress, executor);
  }

  async #configurePartialLiquidator(
    router: string,
    bot: string,
  ): Promise<void> {
    const [currentRouter, currentBot, cms] = await Promise.all([
      this.partialLiquidator.router(),
      this.partialLiquidator.partialLiquidationBot(),
      this.getCreditManagersV3List(),
    ]);

    if (router.toLowerCase() !== currentRouter.toLowerCase()) {
      this.logger.warn(
        `need to update router from ${currentRouter} to ${router}`,
      );
      const tx = await this.partialLiquidator.setRouter(router);
      await tx.wait();
      this.logger.info(`set router to ${router} in tx ${tx.hash}`);
    }

    if (bot.toLowerCase() !== currentBot.toLowerCase()) {
      this.logger.warn(`need to update bot from ${currentBot} to ${bot}`);
      const tx = await this.partialLiquidator.setPartialLiquidationBot(bot);
      await tx.wait();
      this.logger.info(`set bit to ${bot} in tx ${tx.hash}`);
    }

    for (const { address, name } of cms) {
      const ca = await this.partialLiquidator.cmToCA(address);
      if (ca === ADDRESS_0X0) {
        try {
          this.logger.debug(
            `need to register credit manager ${name} (${address})`,
          );
          const tx = await this.partialLiquidator.registerCM(address);
          await tx.wait();
          this.logger.info(
            `registered credit manager ${name} (${address}) in tx ${tx.hash}`,
          );
          this.#registeredCMs[address.toLowerCase()] = true;
        } catch (e) {
          this.logger.error(
            `failed to register credit manager ${name} (${address}): ${e}`,
          );
          this.#registeredCMs[address.toLowerCase()] = false;
        }
      } else {
        this.logger.debug(
          `credit manager ${name} (${address}) already registered with account ${ca}`,
        );
        this.#registeredCMs[address.toLowerCase()] = true;
      }
    }
  }

  #caLogger(ca: CreditAccountData): LoggerInterface {
    return this.logger.child({
      account: ca.addr,
      borrower: ca.borrower,
      manager: ca.managerName,
      hf: ca.healthFactor,
    });
  }

  private get partialLiquidator(): ILiquidator {
    if (!this.#partialLiquidator) {
      throw new Error("strategy not launched");
    }
    return this.#partialLiquidator;
  }

  private get priceHelper(): IPriceHelper {
    if (!this.#priceHelper) {
      throw new Error("strategy not launched");
    }
    return this.#priceHelper;
  }

  private async getConfiguratorAddr(): Promise<string> {
    if (!this.#configuratorAddr) {
      const aclAddr = await this.addressProvider.findService("ACL", 0);
      const acl = IACL__factory.connect(aclAddr, this.executor.provider);
      this.#configuratorAddr = await acl.owner();
      this.logger.debug(`configurator address: ${this.#configuratorAddr}`);
    }
    return this.#configuratorAddr;
  }
}
