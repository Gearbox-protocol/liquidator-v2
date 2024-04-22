import {
  AaveFLTaker__factory,
  ICreditConfiguratorV3__factory,
  ICreditManagerV3__factory,
  Liquidator__factory,
} from "@gearbox-protocol/liquidator-v2-contracts";
import { ILiquidator__factory } from "@gearbox-protocol/liquidator-v2-contracts/dist/factories";
import type { ILiquidator } from "@gearbox-protocol/liquidator-v2-contracts/dist/ILiquidator";
import type {
  CreditAccountData,
  CreditManagerData,
} from "@gearbox-protocol/sdk";
import {
  formatBN,
  getDecimals,
  PERCENTAGE_FACTOR,
  tokenSymbolByAddress,
  WAD,
} from "@gearbox-protocol/sdk";
import { ADDRESS_0X0, contractsByNetwork } from "@gearbox-protocol/sdk-gov";
import type {
  BigNumber,
  BigNumberish,
  ContractReceipt,
  providers,
  Wallet,
} from "ethers";
import { Service } from "typedi";

import { IACL__factory } from "../../generated/IACL__factory";
import { Logger, LoggerInterface } from "../../log";
import { accountName, managerName } from "../utils";
import { impersonate, stopImpersonate } from "../utils/impersonate";
import AbstractLiquidationStrategyV3 from "./AbstractLiquidationStrategyV3";
import type {
  ILiquidationStrategy,
  MakeLiquidatableResult,
  PartialLiquidationPreview,
} from "./types";

interface TokenBalance {
  balance: bigint;
  balanceInUnderlying: bigint;
  lt: bigint;
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

    let partialLiquidatorAddress = this.config.partialLiquidatorAddress;
    if (!partialLiquidatorAddress) {
      partialLiquidatorAddress = await this.#deployPartialLiquidator(
        this.executor.wallet,
        router,
        bot,
        aavePool,
      );
    }
    this.#partialLiquidator = ILiquidator__factory.connect(
      partialLiquidatorAddress,
      this.executor.wallet,
    );
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

    const ltChanges = await this.#calcNewLTs(ca, cm);
    const snapshotId = await (
      this.executor.provider as providers.JsonRpcProvider
    ).send("evm_snapshot", []);

    await this.#setNewLTs(ca, cm, ltChanges);
    const updCa = await this.compressor.callStatic.getCreditAccountData(
      ca.addr,
      [],
    );
    logger.debug({
      hfNew: updCa.healthFactor.toString(),
      hfOld: ca.healthFactor.toString(),
      isSuccessful: updCa.isSuccessful,
    });
    return {
      snapshotId,
      partialLiquidationCondition: {
        hfNew: updCa.healthFactor.toNumber(),
        ltChanges,
      },
    };
  }

  public async preview(
    ca: CreditAccountData,
  ): Promise<PartialLiquidationPreview> {
    const logger = this.#caLogger(ca);
    const cm = await this.getCreditManagerData(ca.creditManager);
    const balances = await this.#prepareAccountTokens(ca, cm);
    const connectors = this.pathFinder.getAvailableConnectors(ca.balances);

    // TODO: maybe this should be refreshed every loop iteration
    const priceUpdates = await this.redstone.liquidationPreviewUpdates(ca);
    for (const [assetOut, { balance, balanceInUnderlying }] of Object.entries(
      balances,
    )) {
      const symb = tokenSymbolByAddress[assetOut.toLowerCase()];
      logger.debug({
        assetOut: `${assetOut} (${symb})`,
        amountOut: `${balance} (${formatBN(balance, getDecimals(assetOut))})`,
        flashLoanAmount: `${balanceInUnderlying} (${formatBN(balanceInUnderlying, getDecimals(cm.underlyingToken))}) ${tokenSymbolByAddress[cm.underlyingToken]}`,
        priceUpdates,
        connectors,
        slippage: this.config.slippage,
      });

      // naively try to figure out amount that works
      const steps = [5n, 10n, 20n, 30n, 40n, 50n];
      for (const i of steps) {
        // 5% then 10-20-30-40-50
        const amountOut = (i * balance) / 100n;
        const flashLoanAmount = (i * balanceInUnderlying) / 100n;
        logger.debug(`trying partial liqudation: ${i}% of ${symb} out`);
        try {
          const result =
            await this.partialLiquidator.callStatic.previewPartialLiquidation(
              ca.creditManager,
              ca.addr,
              assetOut,
              amountOut,
              flashLoanAmount,
              priceUpdates,
              connectors,
              this.config.slippage,
            );
          if (result.calls.length) {
            logger.info(
              `preview of partial liquidation: ${i}% of ${symb} succeeded with profit ${result.profit.toString()}`,
            );
            return {
              amountOut,
              assetOut,
              flashLoanAmount,
              calls: result.calls,
              priceUpdates,
              underlyingBalance: 0n, // TODO: calculate
            };
          }
        } catch (e) {
          // TODO: it's possible to save cast call --trace here
          // if (i === 5n) {
          //   // console.log(">>>> failed");
          //   console.log(e);
          // }
        }
      }
    }

    throw new Error(
      `cannot find token and amount for successfull partial liquidation of ${accountName(ca)}`,
    );
  }

  async #prepareAccountTokens(
    ca: CreditAccountData,
    cm: CreditManagerData,
    skipDust = true,
  ): Promise<Record<string, TokenBalance>> {
    // sort by liquidation threshold ASC, place underlying with lowest priority
    const balances = Object.entries(ca.allBalances)
      .filter(([t, { isEnabled, balance }]) => {
        // filter out dust, we don't want to swap it
        const minBalance = 10n ** BigInt(Math.max(8, getDecimals(t)) - 8);
        // gearbox liquidator only cares about enabled tokens.
        // third-party liquidators might want to handle disabled tokens too
        return isEnabled && (balance > minBalance || !skipDust);
      })
      .map(
        ([t, b]) => [t, b.balance, cm.liquidationThresholds[t] ?? 0n] as const,
      );
    // get balance in underlying
    const converted = await this.oracle.convertMany(
      Object.fromEntries(balances),
      cm.underlyingToken,
    );
    return Object.fromEntries(
      Object.entries(converted)
        .map(
          ([t, balanceInUnderlying]) =>
            [
              t,
              {
                balance: ca.allBalances[t].balance,
                balanceInUnderlying,
                lt: cm.liquidationThresholds[t],
              },
            ] as const,
        )
        // Sort by weighted value descending, but underlying token comes last
        .sort((a, b) => {
          if (a[0] === ca.underlyingToken) return 1;
          if (b[0] === ca.underlyingToken) return -1;
          const aWV = a[1].balanceInUnderlying * a[1].lt;
          const bWV = b[1].balanceInUnderlying * b[1].lt;
          return bWV > aWV ? 1 : -1;
        }),
    );
  }

  /**
   * Given credit accounts, calculates new liquidation thresholds that needs to be set to drop account health factor a bit to make it eligible for partial liquidation
   * @param ca
   */
  async #calcNewLTs(
    ca: CreditAccountData,
    cm: CreditManagerData,
    factor = 9990n,
  ): Promise<Record<string, [ltOld: bigint, ltNew: bigint]>> {
    const logger = this.#caLogger(ca);
    const balances = await this.#prepareAccountTokens(ca, cm);
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
    for (const [t, { balance, balanceInUnderlying, lt }] of Object.entries(
      balances,
    )) {
      if (t === cm.underlyingToken) {
        dividend -= (balance * lt) / PERCENTAGE_FACTOR;
      } else {
        divisor += (balanceInUnderlying * lt) / PERCENTAGE_FACTOR;
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
    for (const [t, { lt }] of Object.entries(balances)) {
      if (t !== cm.underlyingToken) {
        result[t] = [lt, (lt * k) / WAD];
        ltChangesHuman[tokenSymbolByAddress[t]] = `${lt} => ${result[t][1]}`;
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

  public async estimate(
    account: CreditAccountData,
    preview: PartialLiquidationPreview,
  ): Promise<BigNumber> {
    // TODO: recipient?
    // const priceUpdates = await this.redstone.liquidationPreviewUpdates(account);
    return this.partialLiquidator.estimateGas.partialLiquidateAndConvert(
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
    gasLimit?: BigNumberish,
  ): Promise<ContractReceipt> {
    // const priceUpdates = await this.redstone.liquidationPreviewUpdates(account);
    const txData =
      await this.partialLiquidator.populateTransaction.partialLiquidateAndConvert(
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

  async #deployPartialLiquidator(
    executor: Wallet,
    router: string,
    bot: string,
    aavePool: string,
  ): Promise<string> {
    this.logger.info("deploying partial liquidator");

    const aaveFlTakerFactory = new AaveFLTaker__factory(executor);
    const aaveFlTaker = await aaveFlTakerFactory.deploy(aavePool);
    await aaveFlTaker.deployTransaction.wait();
    this.logger.info(
      `deployed AaveFLTaker at ${aaveFlTaker.address} in tx ${aaveFlTaker.deployTransaction.hash}`,
    );

    const liquidatorFactory = new Liquidator__factory(executor);
    const liquidator = await liquidatorFactory.deploy(
      router,
      bot,
      aavePool,
      aaveFlTaker.address,
    );
    await liquidator.deployTransaction.wait();
    this.logger.info(
      `deployed Liquidator ${liquidator.address} in tx ${liquidator.deployTransaction.hash}`,
    );

    const tx = await aaveFlTaker.setAllowedFLReceiver(liquidator.address, true);
    await tx.wait();
    this.logger.info(
      `set allowed flashloan receiver on FLTaker ${aaveFlTaker.address} to ${liquidator.address} in tx ${tx.hash}`,
    );

    return liquidator.address;
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
      manager: managerName(ca),
      hf: ca.healthFactor,
    });
  }

  private get partialLiquidator(): ILiquidator {
    if (!this.#partialLiquidator) {
      throw new Error("strategy not launched");
    }
    return this.#partialLiquidator;
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
