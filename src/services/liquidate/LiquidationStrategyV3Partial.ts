import {
  AaveFLTaker__factory,
  Liquidator__factory,
} from "@gearbox-protocol/liquidator-v2-contracts";
import { ILiquidator__factory } from "@gearbox-protocol/liquidator-v2-contracts/dist/factories";
import type { ILiquidator } from "@gearbox-protocol/liquidator-v2-contracts/dist/ILiquidator";
import type { CreditAccountData } from "@gearbox-protocol/sdk";
import {
  CreditManagerData,
  formatBN,
  getDecimals,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk";
import { ADDRESS_0X0, contractsByNetwork } from "@gearbox-protocol/sdk-gov";
import type {
  BigNumber,
  BigNumberish,
  ContractTransaction,
  providers,
  Wallet,
} from "ethers";
import { Inject, Service } from "typedi";

import config from "../../config";
import { Logger, LoggerInterface } from "../../log";
import { AddressProviderService } from "../AddressProviderService";
import { KeyService } from "../keyService";
import OracleServiceV3 from "../OracleServiceV3";
import { RedstoneServiceV3 } from "../RedstoneServiceV3";
import { accountName, managerName } from "../utils";
import AbstractLiquidationStrategyV3 from "./AbstractLiquidationStrategyV3";
import type { ILiquidationStrategy, PartialLiquidationPreview } from "./types";

interface TokenBalance {
  balance: bigint;
  balanceInUnderlying: bigint;
}

@Service()
export default class LiquidationStrategyV3Partial
  extends AbstractLiquidationStrategyV3
  implements ILiquidationStrategy<PartialLiquidationPreview>
{
  public readonly name = "partial";
  public readonly adverb = "partially";

  @Logger("LiquidationStrategyV3Partial")
  protected logger: LoggerInterface;
  @Inject()
  protected addressProvider: AddressProviderService;
  @Inject()
  protected redstone: RedstoneServiceV3;
  @Inject()
  protected keyService: KeyService;
  @Inject()
  protected oracle: OracleServiceV3;

  #partialLiquidatorAddress?: string;
  #partialLiquidator?: ILiquidator;

  constructor() {
    super();
    this.#partialLiquidatorAddress = config.partialLiquidatorAddress;
  }

  public async launch(provider: providers.Provider): Promise<void> {
    await super.launch(provider);
    // TODO: this executor/keyService thing should be removed
    const executor = this.keyService.takeVacantExecutor();

    const router = await this.addressProvider.findService("ROUTER", 300);
    const bot = await this.addressProvider.findService(
      "PARTIAL_LIQUIDATION_BOT",
      300,
    );
    const aavePool =
      contractsByNetwork[this.addressProvider.network].AAVE_V3_LENDING_POOL;
    this.logger.debug(`router=${router}, bot=${bot}, aave pool = ${aavePool}`);

    if (!this.#partialLiquidatorAddress) {
      this.#partialLiquidatorAddress = await this.#deployPartialLiquidator(
        executor,
        router,
        bot,
        aavePool,
      );
    }
    this.#partialLiquidator = ILiquidator__factory.connect(
      this.#partialLiquidatorAddress,
      executor,
    );
    await this.#configurePartialLiquidator(executor, router, bot);
    await this.keyService.returnExecutor(executor.address, true);
  }

  public async preview(
    ca: CreditAccountData,
    slippage: number,
  ): Promise<PartialLiquidationPreview> {
    const logger = this.logger.child({
      account: ca.addr,
      borrower: ca.borrower,
      manager: managerName(ca),
    });
    const cm = new CreditManagerData(
      await this.compressor.getCreditManagerData(ca.creditManager),
    );
    const balances = await this.#prepareAccountTokens(ca, cm);

    // this should do it, we are only interested in keys of a record
    const connectors = this.pathFinder.getAvailableConnectors(balances as any);

    // TODO: maybe this should be refreshed every loop iteration
    const priceUpdates = await this.redstone.liquidationPreviewUpdates(ca);
    for (const [assetOut, { balance, balanceInUnderlying }] of Object.entries(
      balances,
    )) {
      const symb = tokenSymbolByAddress[assetOut.toLowerCase()];
      logger.debug(
        `trying ${formatBN(balance, getDecimals(assetOut))} ${symb} == ${formatBN(balanceInUnderlying, getDecimals(cm.underlyingToken))} ${tokenSymbolByAddress[cm.underlyingToken]}`,
      );

      // naively try to figure out amount that works
      for (let i = 1n; i <= 10n; i++) {
        const amountOut = (i * balance) / 10n;
        const flashLoanAmount = (i * balanceInUnderlying) / 10n;
        logger.debug(`trying partial liqudation: ${i * 10n}% of ${symb} out`);
        try {
          const result =
            await this.partialLiquidator.callStatic.previewPartialLiquidation(
              cm.address,
              ca.addr,
              assetOut,
              amountOut,
              flashLoanAmount,
              priceUpdates,
              connectors,
              slippage,
            );
          if (result.calls.length) {
            logger.info(
              `preview of partial liquidation: ${i * 10n}% of ${symb} succeeded with profit ${result.profit.toString()}`,
            );
            return {
              amountOut,
              assetOut,
              flashLoanAmount,
              calls: result.calls,
              underlyingBalance: 0n, // TODO: calculate
            };
          }
        } catch (e) {
          // console.log(e);
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
  ): Promise<Record<string, TokenBalance>> {
    // sort by liquidation threshold ASC, place underlying with lowest priority
    const balances = Object.entries(ca.allBalances)
      .filter(([t, { isEnabled, balance }]) => {
        // filter out dust, we don't want to swap it
        const minBalance = 10n ** BigInt(Math.max(8, getDecimals(t)) - 8);
        // gearbox liquidator only cares about enabled tokens.
        // third-party liquidators might want to handle disabled tokens too
        return isEnabled && balance > minBalance;
      })
      .map(
        ([t, b]) => [t, b.balance, cm.liquidationThresholds[t] ?? 0n] as const,
      )
      .sort((a, b) => {
        if (a[0] === ca.underlyingToken) return 1;
        if (b[0] === ca.underlyingToken) return -1;
        return Number(a[2]) - Number(b[2]);
      });
    // get balance in underlying
    const converted = await this.oracle.convertMany(
      Object.fromEntries(balances),
      cm.underlyingToken,
    );
    return Object.fromEntries(
      Object.entries(converted).map(([t, balanceInUnderlying]) => [
        t,
        { balance: ca.allBalances[t].balance, balanceInUnderlying },
      ]),
    );
  }

  public async estimate(
    executor: Wallet,
    account: CreditAccountData,
    preview: PartialLiquidationPreview,
    recipient: string,
  ): Promise<BigNumber> {
    // TODO: recipient?
    const priceUpdates = await this.redstone.liquidationPreviewUpdates(account);
    const partialLiquidator = this.partialLiquidator.connect(executor);
    return partialLiquidator.estimateGas.partialLiquidateAndConvert(
      account.creditManager,
      account.addr,
      preview.assetOut,
      preview.amountOut,
      preview.flashLoanAmount,
      priceUpdates,
      preview.calls,
    );
  }

  public async liquidate(
    executor: Wallet,
    account: CreditAccountData,
    preview: PartialLiquidationPreview,
    recipient: string,
    gasLimit?: BigNumberish,
  ): Promise<ContractTransaction> {
    // TODO: recipient
    const priceUpdates = await this.redstone.liquidationPreviewUpdates(account);
    const partialLiquidator = this.partialLiquidator.connect(executor);
    return partialLiquidator.partialLiquidateAndConvert(
      account.creditManager,
      account.addr,
      preview.assetOut,
      preview.amountOut,
      preview.flashLoanAmount,
      priceUpdates,
      preview.calls,
      gasLimit ? { gasLimit } : {},
    );
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
    executor: Wallet,
    router: string,
    bot: string,
  ): Promise<void> {
    const [currentRouter, currentBot, cms] = await Promise.all([
      this.partialLiquidator.router(),
      this.partialLiquidator.partialLiquidationBot(),
      this.compressor.getCreditManagersV3List(),
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

    for (const { addr, name } of cms) {
      const ca = await this.partialLiquidator.cmToCA(addr);
      if (ca === ADDRESS_0X0) {
        try {
          this.logger.debug(
            `need to register credit manager ${name} (${addr})`,
          );
          const tx = await this.partialLiquidator.registerCM(addr);
          await tx.wait();
          this.logger.info(
            `registered credit manager ${name} (${addr}) in tx ${tx.hash}`,
          );
        } catch (e) {
          this.logger.error(
            `failed to register credit manager ${name} (${addr}): ${e}`,
          );
        }
      } else {
        this.logger.debug(
          `credit manager ${name} (${addr}) already registered`,
        );
      }
    }
  }

  private get partialLiquidator(): ILiquidator {
    if (!this.#partialLiquidator) {
      throw new Error("strategy not launched");
    }
    return this.#partialLiquidator;
  }
}
