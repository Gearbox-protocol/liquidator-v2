import {
  ILiquidator__factory,
  SafeERC20__factory,
} from "@gearbox-protocol/liquidator-v2-contracts";
import { tokenSymbolByAddress } from "@gearbox-protocol/sdk-gov";
import {
  ICreditFacadeV3__factory,
  ICreditManagerV3__factory,
  IERC20__factory,
  IExceptions__factory,
  IPriceOracleV3__factory,
  IRouterV3__factory,
} from "@gearbox-protocol/types/v3";
import type { JsonRpcProvider, TransactionReceipt } from "ethers";
import { isError, Provider, Wallet } from "ethers";
import { ErrorDecoder } from "ethers-decode-error";
import Container, { Inject, Service } from "typedi";

import { CONFIG, type ConfigSchema } from "../../config";
import { Logger, LoggerInterface } from "../../log";
import { filterDust, formatTs, PROVIDER } from "../../utils";
import type { CreditAccountData } from "../../utils/ethers-6-temp";
import { TxParserHelper } from "../../utils/ethers-6-temp/txparser";
import { AddressProviderService } from "../AddressProviderService";
import { INotifier, NOTIFIER } from "../notifier";
import { type IOptimisticOutputWriter, OUTPUT_WRITER } from "../output";
import { RedstoneServiceV3 } from "../RedstoneServiceV3";
import { type ISwapper, SWAPPER } from "../swap";
import LiquidationStrategyV3Full from "./LiquidationStrategyV3Full";
import LiquidationStrategyV3Partial from "./LiquidationStrategyV3Partial";
import { OptimisticResults } from "./OptimisiticResults";
import type {
  ILiquidationStrategy,
  ILiquidatorService,
  OptimisticResultV2,
  StrategyPreview,
} from "./types";

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
  config: ConfigSchema;

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

  protected strategy: ILiquidationStrategy<StrategyPreview>;

  #errorDecoder = ErrorDecoder.create();

  #etherscanUrl = "";

  /**
   * Launch LiquidatorService
   */
  public async launch(): Promise<void> {
    this.#errorDecoder = ErrorDecoder.create([
      IPriceOracleV3__factory.createInterface(),
      ICreditFacadeV3__factory.createInterface(),
      ICreditManagerV3__factory.createInterface(),
      ILiquidator__factory.createInterface(),
      IRouterV3__factory.createInterface(),
      IExceptions__factory.createInterface(),
      SafeERC20__factory.createInterface(),
    ]);
    switch (this.addressProvider.network) {
      case "Mainnet":
        this.#etherscanUrl = "https://etherscan.io";
        break;
      case "Arbitrum":
        this.#etherscanUrl = "https://arbiscan.io";
        break;
      case "Optimism":
        this.#etherscanUrl = "https://optimistic.etherscan.io";
        break;
    }
    const { partialLiquidatorAddress, deployPartialLiquidatorContracts } =
      this.config;
    this.strategy =
      partialLiquidatorAddress || deployPartialLiquidatorContracts
        ? Container.get(LiquidationStrategyV3Partial)
        : Container.get(LiquidationStrategyV3Full);
    await this.strategy.launch();
    this.notifier.notify("started liquidator");
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
    this.notifier.alert(
      `begin ${this.strategy.name} liquidation of ${ca.name} with HF ${ca.healthFactor}`,
    );
    let pathHuman: string[] | undefined;
    try {
      const preview = await this.strategy.preview(ca);
      pathHuman = TxParserHelper.parseMultiCall(preview);
      logger.debug({ pathHuman }, "path found");

      const receipt = await this.strategy.liquidate(ca, preview);

      this.notifier
        .alert(`account ${ca.name} was ${this.strategy.adverb} liquidated      
Tx receipt: ${this.etherscan(receipt)}
Gas used: ${receipt.gasUsed.toLocaleString("en")}
Path used:
${pathHuman.join("\n")}`);
    } catch (e) {
      const decoded = await this.#errorDecoder.decode(e);
      const error = `cant liquidate: ${decoded.type}: ${decoded.reason}`;
      logger.error({ decoded, original: e }, "cant liquidate");
      this.notifier
        .alert(`${this.strategy.name} liquidation of ${ca.name} failed.
Path: ${pathHuman ?? "not found"}
Error: ${error}`);
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
      balancesBefore: filterDust(acc.allBalances),
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
      optimisticResult.calls = preview.calls;
      optimisticResult.pathAmount = preview.underlyingBalance.toString();
      optimisticResult.priceUpdates = preview.priceUpdates;
      optimisticResult.callsHuman = TxParserHelper.parseMultiCall(preview);
      logger.debug({ pathHuman: optimisticResult.callsHuman }, "path found");

      let gasLimit = 29_000_000n;
      // before actual transaction, try to estimate gas
      // this effectively will load state and contracts from fork origin to anvil
      // so following actual tx should not be slow
      // also tx will act as retry in case of anvil external's error
      try {
        gasLimit = await this.strategy.estimate(acc, preview);
      } catch (e: any) {
        const decoded = await this.#errorDecoder.decode(e);
        optimisticResult.error = `failed to estimate gas: ${decoded.type}: ${decoded.reason}`;
        logger.error(optimisticResult.error);
      }

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
        const receipt = await this.strategy.liquidate(acc, preview, gasLimit);
        logger.debug(`Liquidation tx hash: ${receipt.hash}`);
        optimisticResult.isError = receipt.status !== 1;
        const strStatus = optimisticResult.isError ? "failure" : "success";
        logger.debug(
          `Liquidation tx receipt: status=${strStatus} (${
            receipt.status
          }), gas=${receipt.cumulativeGasUsed.toString()}`,
        );
        acc = await this.strategy.updateCreditAccountData(acc);
        optimisticResult.balancesAfter = filterDust(acc.allBalances);
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
        await this.saveTxTrace(e);
        // there's some decoder error that returns nonce error instead of revert error
        // in such cases, estimate gas error is reliably parsed
        optimisticResult.error ||= `cant liquidate: ${decoded.type}: ${decoded.reason}`;
        logger.error({ decoded, original: e }, "cant liquidate");
      }
    } catch (e: any) {
      const decoded = await this.#errorDecoder.decode(e);
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
   * @param txHash
   * @returns
   */
  protected async saveTxTrace(e: any): Promise<void> {
    if (isError(e, "CALL_EXCEPTION") && e.receipt) {
      try {
        const txTrace = await (this.provider as JsonRpcProvider).send(
          "trace_transaction",
          [e.receipt.hash],
        );
        await this.outputWriter.write(e.receipt.hash, txTrace);
        this.log.debug(`saved trace_transaction result for ${e.receipt.hash}`);
      } catch (e) {
        this.log.warn(`failed to save tx trace: ${e}`);
      }
    }
  }

  protected etherscan({ hash }: TransactionReceipt): string {
    return `${this.#etherscanUrl}/tx/${hash}`;
  }
}
