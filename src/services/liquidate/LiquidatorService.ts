import { tokenSymbolByAddress } from "@gearbox-protocol/sdk-gov";
import { ierc20Abi } from "@gearbox-protocol/types/abi";
import type { OptimisticResultV2 } from "@gearbox-protocol/types/optimist";
import type { Address, Hex } from "viem";

import type { Config } from "../../config/index.js";
import type { CreditAccountData } from "../../data/index.js";
import { DI } from "../../di.js";
import { ErrorHandler } from "../../errors/index.js";
import { type ILogger, Logger } from "../../log/index.js";
import { TxParserHelper } from "../../utils/ethers-6-temp/txparser/index.js";
import type { AddressProviderService } from "../AddressProviderService.js";
import type Client from "../Client.js";
import type { INotifier } from "../notifier/index.js";
import {
  LiquidationErrorMessage,
  LiquidationStartMessage,
  LiquidationSuccessMessage,
  StartedMessage,
} from "../notifier/index.js";
import type { IOptimisticOutputWriter } from "../output/index.js";
import type { RedstoneServiceV3 } from "../RedstoneServiceV3.js";
import type { ISwapper } from "../swap/index.js";
import LiquidationStrategyV3Full from "./LiquidationStrategyV3Full.js";
import LiquidationStrategyV3Partial from "./LiquidationStrategyV3Partial.js";
import type { OptimisticResults } from "./OptimisiticResults.js";
import type {
  ILiquidationStrategy,
  ILiquidatorService,
  StrategyPreview,
} from "./types.js";

export interface Balance {
  underlying: bigint;
  eth: bigint;
}

@DI.Injectable(DI.Liquidator)
export class LiquidatorService implements ILiquidatorService {
  @Logger("Liquidator")
  log!: ILogger;

  @DI.Inject(DI.Redstone)
  redstone!: RedstoneServiceV3;

  @DI.Inject(DI.Notifier)
  notifier!: INotifier;

  @DI.Inject(DI.Config)
  config!: Config;

  @DI.Inject(DI.AddressProvider)
  addressProvider!: AddressProviderService;

  @DI.Inject(DI.Output)
  outputWriter!: IOptimisticOutputWriter;

  @DI.Inject(DI.Swapper)
  swapper!: ISwapper;

  @DI.Inject(DI.OptimisticResults)
  optimistic!: OptimisticResults;

  @DI.Inject(DI.Client)
  client!: Client;

  #errorHandler!: ErrorHandler;

  protected strategy!: ILiquidationStrategy<StrategyPreview>;

  /**
   * Launch LiquidatorService
   */
  public async launch(): Promise<void> {
    this.#errorHandler = new ErrorHandler(this.config, this.log);
    const { partialLiquidatorAddress, deployPartialLiquidatorContracts } =
      this.config;
    this.strategy =
      partialLiquidatorAddress || deployPartialLiquidatorContracts
        ? (new LiquidationStrategyV3Partial() as any)
        : (new LiquidationStrategyV3Full() as any);
    await this.strategy.launch();
    this.notifier.notify(new StartedMessage());
  }

  public async liquidate(ca: CreditAccountData): Promise<void> {
    const logger = this.log.child({
      account: ca.addr,
      borrower: ca.borrower,
      manager: ca.managerName,
    });
    logger.info(
      `begin ${this.strategy.name} liquidation: HF = ${ca.healthFactor}`,
    );
    this.notifier.notify(new LiquidationStartMessage(ca, this.strategy.name));
    let pathHuman: string[] | undefined;
    try {
      const preview = await this.strategy.preview(ca);
      pathHuman = TxParserHelper.parseMultiCall(preview);
      logger.debug({ pathHuman }, "path found");

      const { request } = await this.strategy.simulate(ca, preview);
      const receipt = await this.client.liquidate(ca, request);

      this.notifier.alert(
        new LiquidationSuccessMessage(
          ca,
          this.strategy.adverb,
          receipt,
          pathHuman,
        ),
      );
    } catch (e) {
      const decoded = await this.#errorHandler.explain(e, ca);
      logger.error(decoded, "cant liquidate");
      this.notifier.alert(
        new LiquidationErrorMessage(
          ca,
          this.strategy.adverb,
          decoded.shortMessage,
          pathHuman,
        ),
      );
    }
  }

  public async liquidateOptimistic(
    ca: CreditAccountData,
  ): Promise<OptimisticResultV2> {
    let acc = ca;
    const logger = this.log.child({
      account: acc.addr,
      borrower: acc.borrower,
      manager: acc.managerName,
    });
    let snapshotId: Hex | undefined;
    const optimisticResult: OptimisticResultV2 = {
      version: "2",
      creditManager: acc.creditManager,
      borrower: acc.borrower,
      account: acc.addr,
      balancesBefore: ca.filterDust(),
      hfBefore: acc.healthFactor,
      balancesAfter: {},
      hfAfter: 0,
      gasUsed: 0,
      calls: [],
      callsHuman: [],
      isError: true,
      pathAmount: "0",
      liquidatorPremium: "0",
      liquidatorProfit: "0",
    };
    const start = Date.now();
    try {
      const balanceBefore = await this.getExecutorBalance(acc.underlyingToken);
      const mlRes = await this.strategy.makeLiquidatable(acc);
      snapshotId = mlRes.snapshotId;
      optimisticResult.partialLiquidationCondition =
        mlRes.partialLiquidationCondition;
      logger.debug({ snapshotId }, "previewing...");
      const preview = await this.strategy.preview(acc);
      optimisticResult.assetOut = preview.assetOut;
      optimisticResult.amountOut = preview.amountOut;
      optimisticResult.flashLoanAmount = preview.flashLoanAmount;
      optimisticResult.calls = preview.calls;
      optimisticResult.pathAmount = preview.underlyingBalance.toString();
      optimisticResult.priceUpdates = preview.priceUpdates;
      optimisticResult.callsHuman = TxParserHelper.parseMultiCall(preview);
      logger.debug({ pathHuman: optimisticResult.callsHuman }, "path found");

      const { request } = await this.strategy.simulate(acc, preview);

      // snapshotId might be present if we had to setup liquidation conditions for single account
      // otherwise, not write requests has been made up to this point, and it's safe to take snapshot now
      if (!snapshotId) {
        snapshotId = await this.client.anvil.snapshot();
      }
      // ------ Actual liquidation (write request start here) -----
      const receipt = await this.client.liquidate(acc, request);
      logger.debug(`Liquidation tx hash: ${receipt.transactionHash}`);
      optimisticResult.isError = receipt.status === "reverted";
      logger.debug(
        `Liquidation tx receipt: status=${receipt.status}, gas=${receipt.cumulativeGasUsed.toString()}`,
      );
      // ------ End of actual liquidation
      acc = await this.strategy.updateCreditAccountData(acc);
      optimisticResult.balancesAfter = ca.filterDust();
      optimisticResult.hfAfter = acc.healthFactor;

      let balanceAfter = await this.getExecutorBalance(acc.underlyingToken);
      optimisticResult.gasUsed = Number(receipt.gasUsed);
      optimisticResult.liquidatorPremium = (
        balanceAfter.underlying - balanceBefore.underlying
      ).toString(10);
      // swap underlying back to ETH
      await this.swapper.swap(acc.underlyingToken, balanceAfter.underlying);
      balanceAfter = await this.getExecutorBalance(acc.underlyingToken);
      optimisticResult.liquidatorProfit = (
        balanceAfter.eth - balanceBefore.eth
      ).toString(10);
    } catch (e: any) {
      const decoded = await this.#errorHandler.explain(e, acc, true);
      optimisticResult.traceFile = decoded.traceFile;
      optimisticResult.error =
        `cannot liquidate: ${decoded.longMessage}`.replaceAll("\n", "\\n");
      logger.error({ decoded }, "cannot liquidate");
    }

    optimisticResult.duration = Date.now() - start;
    this.optimistic.push(optimisticResult);

    if (snapshotId) {
      await this.client.anvil.revert({ id: snapshotId });
    }

    return optimisticResult;
  }

  protected async getExecutorBalance(
    underlyingToken: Address,
  ): Promise<Balance> {
    // using promise.all here sometimes results in anvil being stuck
    const isWeth = tokenSymbolByAddress[underlyingToken] === "WETH";
    const eth = await this.client.pub.getBalance({
      address: this.client.address,
    });
    const underlying = isWeth
      ? eth
      : await this.client.pub.readContract({
          address: underlyingToken,
          abi: ierc20Abi,
          functionName: "balanceOf",
          args: [this.client.address],
        });
    return { eth, underlying };
  }
}
