import { tokenSymbolByAddress } from "@gearbox-protocol/sdk-gov";
import { ierc20Abi } from "@gearbox-protocol/types/abi";
import type { OptimisticResultV2 } from "@gearbox-protocol/types/optimist";
import { Container, Inject, Service } from "typedi";
import type { Address, Hex } from "viem";

import { CONFIG, type Config } from "../../config/index.js";
import type { CreditAccountData } from "../../data/index.js";
import { Logger, LoggerInterface } from "../../log/index.js";
import { ErrorHandler } from "../../utils/ErrorHandler.js";
import { TxParserHelper } from "../../utils/ethers-6-temp/txparser/index.js";
import { AddressProviderService } from "../AddressProviderService.js";
import Client from "../Client.js";
import {
  INotifier,
  LiquidationErrorMessage,
  LiquidationStartMessage,
  LiquidationSuccessMessage,
  NOTIFIER,
  StartedMessage,
} from "../notifier/index.js";
import {
  type IOptimisticOutputWriter,
  OUTPUT_WRITER,
} from "../output/index.js";
import { RedstoneServiceV3 } from "../RedstoneServiceV3.js";
import { type ISwapper, SWAPPER } from "../swap/index.js";
import LiquidationStrategyV3Full from "./LiquidationStrategyV3Full.js";
import LiquidationStrategyV3Partial from "./LiquidationStrategyV3Partial.js";
import { OptimisticResults } from "./OptimisiticResults.js";
import type {
  ILiquidationStrategy,
  ILiquidatorService,
  StrategyPreview,
} from "./types.js";

export interface Balance {
  underlying: bigint;
  eth: bigint;
}

@Service()
export class LiquidatorService implements ILiquidatorService {
  @Logger("LiquidatorService")
  log: LoggerInterface;

  @Inject()
  redstone: RedstoneServiceV3;

  @Inject(NOTIFIER)
  notifier: INotifier;

  @Inject(CONFIG)
  config: Config;

  @Inject()
  addressProvider: AddressProviderService;

  @Inject(OUTPUT_WRITER)
  outputWriter: IOptimisticOutputWriter;

  @Inject(SWAPPER)
  swapper: ISwapper;

  @Inject()
  optimistic: OptimisticResults;

  @Inject()
  client: Client;

  @Inject()
  erroHandler: ErrorHandler;

  protected strategy: ILiquidationStrategy<StrategyPreview>;

  /**
   * Launch LiquidatorService
   */
  public async launch(): Promise<void> {
    const { partialLiquidatorAddress, deployPartialLiquidatorContracts } =
      this.config;
    this.strategy =
      partialLiquidatorAddress || deployPartialLiquidatorContracts
        ? Container.get(LiquidationStrategyV3Partial)
        : Container.get(LiquidationStrategyV3Full);
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
    this.notifier.alert(new LiquidationStartMessage(ca, this.strategy.name));
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
      const decoded = await this.erroHandler.explain(e);
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
      const decoded = await this.erroHandler.explain(e);
      optimisticResult.traceFile = decoded.traceFile;
      optimisticResult.error = `cannot liquidate: ${decoded.shortMessage}`;
      logger.error({ decoded, original: e }, "cannot liquidate");
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
