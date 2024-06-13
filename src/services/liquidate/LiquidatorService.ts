import events from "node:events";
import { createWriteStream } from "node:fs";
import path from "node:path";

import {
  ILiquidator__factory,
  SafeERC20__factory,
} from "@gearbox-protocol/liquidator-v2-contracts/types";
import { tokenSymbolByAddress } from "@gearbox-protocol/sdk-gov";
import type { OptimisticResultV2 } from "@gearbox-protocol/types/optimist";
import {
  ICreditFacadeV3__factory,
  ICreditManagerV3__factory,
  IERC20__factory,
  IExceptions__factory,
  IPriceOracleV3__factory,
  IRouterV3__factory,
} from "@gearbox-protocol/types/v3";
import type { JsonRpcProvider } from "ethers";
import { isError, Provider, Wallet } from "ethers";
import { ErrorDecoder } from "ethers-decode-error";
import { nanoid } from "nanoid";
import { spawn } from "node-pty";
import { Container, Inject, Service } from "typedi";

import { CONFIG, type Config } from "../../config/index.js";
import type { CreditAccountData } from "../../data/index.js";
import { Logger, LoggerInterface } from "../../log/index.js";
import { TxParserHelper } from "../../utils/ethers-6-temp/txparser/index.js";
import { formatTs, PROVIDER } from "../../utils/index.js";
import { AddressProviderService } from "../AddressProviderService.js";
import ExecutorService from "../ExecutorService.js";
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

  @Inject(PROVIDER)
  provider: Provider;

  @Inject()
  wallet: Wallet;

  @Inject()
  executor: ExecutorService;

  protected strategy: ILiquidationStrategy<StrategyPreview>;

  #errorDecoder = ErrorDecoder.create();

  /**
   * Launch LiquidatorService
   */
  public async launch(): Promise<void> {
    // ethers-decode-error is wrongly detected as CJS module
    this.#errorDecoder = ErrorDecoder.create([
      Array.from(IPriceOracleV3__factory.createInterface().fragments) as any,
      Array.from(ICreditFacadeV3__factory.createInterface().fragments) as any,
      Array.from(ICreditManagerV3__factory.createInterface().fragments) as any,
      Array.from(ILiquidator__factory.createInterface().fragments) as any,
      Array.from(IRouterV3__factory.createInterface().fragments) as any,
      Array.from(IExceptions__factory.createInterface().fragments) as any,
      Array.from(SafeERC20__factory.createInterface().fragments) as any,
    ]);
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
      const receipt = await this.executor.liquidate(ca, request);

      this.notifier.alert(
        new LiquidationSuccessMessage(
          ca,
          this.strategy.adverb,
          receipt,
          pathHuman,
        ),
      );
    } catch (e) {
      const decoded = await this.#errorDecoder.decode(e);
      const error = `cant liquidate: ${decoded.type}: ${decoded.reason}`;
      logger.error({ decoded, original: e }, "cant liquidate");
      this.notifier.alert(
        new LiquidationErrorMessage(ca, this.strategy.adverb, error, pathHuman),
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
    let snapshotId: number | undefined;
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
    // On anvil fork of L2, block.number is anvil block
    const startBlock = await this.provider.getBlock("latest").catch(() => null);
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
      optimisticResult.calls = preview.calls as any;
      optimisticResult.pathAmount = preview.underlyingBalance.toString();
      optimisticResult.priceUpdates = preview.priceUpdates;
      optimisticResult.callsHuman = TxParserHelper.parseMultiCall(preview);
      logger.debug({ pathHuman: optimisticResult.callsHuman }, "path found");

      const { request } = await this.strategy.simulate(acc, preview);

      // snapshotId might be present if we had to setup liquidation conditions for single account
      // otherwise, not write requests has been made up to this point, and it's safe to take snapshot now
      if (!snapshotId) {
        snapshotId = await (this.provider as JsonRpcProvider).send(
          "evm_snapshot",
          [],
        );
      }
      // Actual liquidation (write requests start here)
      try {
        // send profit to executor address because we're going to use swapper later
        const receipt = await this.executor.liquidate(acc, request);
        logger.debug(`Liquidation tx hash: ${receipt.transactionHash}`);
        optimisticResult.isError = receipt.status === "reverted";
        logger.debug(
          `Liquidation tx receipt: status=${receipt.status}, gas=${receipt.cumulativeGasUsed.toString()}`,
        );
        acc = await this.strategy.updateCreditAccountData(acc);
        optimisticResult.balancesAfter = ca.filterDust();
        optimisticResult.hfAfter = acc.healthFactor;

        let balanceAfter = await this.getExecutorBalance(acc.underlyingToken);
        optimisticResult.gasUsed = Number(receipt.gasUsed);
        optimisticResult.liquidatorPremium = (
          balanceAfter.underlying - balanceBefore.underlying
        ).toString(10);
        // swap underlying back to ETH
        await this.swapper.swap(
          this.wallet,
          acc.underlyingToken,
          balanceAfter.underlying,
        );
        balanceAfter = await this.getExecutorBalance(acc.underlyingToken);
        optimisticResult.liquidatorProfit = (
          balanceAfter.eth - balanceBefore.eth
        ).toString(10);
      } catch (e: any) {
        const decoded = await this.#errorDecoder.decode(e);
        optimisticResult.traceFile = await this.saveErrorTrace(e);
        // there's some decoder error that returns nonce error instead of revert error
        // in such cases, estimate gas error is reliably parsed
        optimisticResult.error ||= `cant liquidate: ${decoded.type}: ${decoded.reason}`;
        logger.error({ decoded, original: e }, "cant liquidate");
      }
    } catch (e: any) {
      const decoded = await this.#errorDecoder.decode(e);
      optimisticResult.traceFile = await this.saveErrorTrace(e);
      optimisticResult.error = `cannot liquidate: ${decoded.type}: ${decoded.reason}`;
      logger.error({ decoded, original: e }, "cannot liquidate");
    }

    optimisticResult.duration = Date.now() - start;
    const endBlock = await this.provider.getBlock("latest").catch(() => null);
    if (startBlock && endBlock) {
      logger.debug(
        { tag: "timing" },
        `liquidation blocktime = ${endBlock.timestamp - startBlock.timestamp} (${formatTs(startBlock)} to ${formatTs(endBlock)})`,
      );
    }
    this.optimistic.push(optimisticResult);

    if (snapshotId) {
      await (this.provider as JsonRpcProvider).send("evm_revert", [snapshotId]);
    }

    return optimisticResult;
  }

  protected async getExecutorBalance(
    underlyingToken: string,
  ): Promise<Balance> {
    // using promise.all here sometimes results in anvil being stuck
    const isWeth = tokenSymbolByAddress[underlyingToken] === "WETH";
    const eth = await this.provider.getBalance(this.wallet.address);
    const underlying = isWeth
      ? eth
      : await IERC20__factory.connect(underlyingToken, this.provider).balanceOf(
          this.wallet.address,
        );
    return { eth, underlying };
  }

  /**
   * Safely tries to save trace of failed transaction to configured output
   * @param error
   * @returns
   */
  protected async saveErrorTrace(e: any): Promise<string | undefined> {
    if (!this.config.castBin || !this.config.outDir) {
      return undefined;
    }

    if (isError(e, "CALL_EXCEPTION") && e.transaction?.to) {
      try {
        const traceId = `${nanoid()}.trace`;
        const traceFile = path.resolve(this.config.outDir, traceId);
        const out = createWriteStream(traceFile, "utf-8");
        await events.once(out, "open");
        // use node-pty instead of node:child_process to have colored output
        const pty = spawn(
          this.config.castBin,
          [
            "call",
            "--trace",
            "--rpc-url",
            this.config.ethProviderRpcs[0],
            e.transaction.to,
            e.transaction.data,
          ],
          { cols: 1024 },
        );
        pty.onData(data => out.write(data));
        await new Promise(resolve => {
          pty.onExit(() => resolve(undefined));
        });
        this.log.debug(`saved trace file: ${traceFile}`);
        return traceId;
      } catch (e) {
        this.log.warn(`failed to save trace: ${e}`);
      }
    }
  }
}
