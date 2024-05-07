import { tokenSymbolByAddress } from "@gearbox-protocol/sdk-gov";
import { IERC20__factory } from "@gearbox-protocol/types/v3";
import type { JsonRpcProvider, TransactionReceipt } from "ethers";
import { Provider, Wallet } from "ethers";
import { ErrorDecoder } from "ethers-decode-error";
import Container, { Inject, Service } from "typedi";

import { CONFIG, type ConfigSchema } from "../../config";
import { Logger, LoggerInterface } from "../../log";
import { filterDust, PROVIDER } from "../../utils";
import type { CreditAccountData } from "../../utils/ethers-6-temp";
import { TxParser } from "../../utils/ethers-6-temp/txparser";
import { AddressProviderService } from "../AddressProviderService";
import { AMPQService } from "../ampqService";
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

const errorDecoder = ErrorDecoder.create();
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

  @Inject()
  ampqService: AMPQService;

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

  #etherscanUrl = "";

  /**
   * Launch LiquidatorService
   */
  public async launch(): Promise<void> {
    if (this.config.optimistic) {
      // this is needed because otherwise it's possible to hit deadlines in uniswap calls
      await (this.provider as JsonRpcProvider).send(
        "anvil_setBlockTimestampInterval",
        [1],
      );
      this.log.info("set block timestamp interval to 1");
    }
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
  }

  public async liquidate(ca: CreditAccountData): Promise<void> {
    this.ampqService.info(
      `start ${this.strategy.name} liquidation of ${ca.name} with HF ${ca.healthFactor}`,
    );
    try {
      const preview = await this.strategy.preview(ca);
      let pathHuman: Array<string | null> = [];
      try {
        pathHuman = TxParser.parseMultiCall(preview.calls);
      } catch (e) {
        pathHuman = [`${e}`];
      }
      this.log.debug(pathHuman);

      const receipt = await this.strategy.liquidate(ca, preview);

      this.ampqService.info(
        `account ${ca.name} was ${this.strategy.adverb} liquidated\nTx receipt: ${this.etherscan(receipt)}\nGas used: ${receipt.gasUsed.toLocaleString(
          "en",
        )}\nPath used:\n${pathHuman.join("\n")}`,
      );
    } catch (e) {
      this.ampqService.error(
        `${this.strategy.name} liquidation of ${ca.name} failed: ${e}`,
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
      balancesBefore: filterDust(acc.balances),
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

      try {
        optimisticResult.callsHuman = TxParser.parseMultiCall(
          preview.calls,
        ).filter((s): s is string => !!s);
      } catch (e) {
        optimisticResult.callsHuman = [`${e}`];
      }
      logger.debug({ pathHuman: optimisticResult.callsHuman }, "path found");

      let gasLimit = 29_000_000n;
      // before actual transaction, try to estimate gas
      // this effectively will load state and contracts from fork origin to anvil
      // so following actual tx should not be slow
      // also tx will act as retry in case of anvil external's error
      try {
        gasLimit = await this.strategy.estimate(acc, preview);
      } catch (e: any) {
        // if (e.code === utils.this.log.errors.UNPREDICTABLE_GAS_LIMIT) {
        //   this.log.error(`failed to estimate gas: ${e.reason}`);
        // } else {
        //   this.log.debug(`failed to esitmate gas: ${e.code} ${Object.keys(e)}`);
        // }
        logger.error(`failed to estimate gas: ${e}`);
        const decoded = await errorDecoder.decode(e);
        logger.error({ decoded }, "decoded error");
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
        optimisticResult.balancesAfter = filterDust(acc.balances);
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

        if (balanceAfter.eth < balanceBefore.eth) {
          logger.warn("negative liquidator profit");
        }
      } catch (e: any) {
        logger.error(`cant liquidate: ${e}`);
        logger.error(
          {
            code: e.code,
            action: e.action,
            reason: e.reason,
            data: e.data,
            receipt: e.receipt,
            transaction: e.transaction,
            revert: e.revert,
          },
          `error keys`,
        );
        // code,action,data,reason,invocation,revert,transaction,receipt,shortMessage,attemptNumber,retriesLeft
        const decoded = await errorDecoder.decode(e);
        logger.error({ decoded }, "decoded error");
        await this.saveTxTrace(e.transactionHash);
        optimisticResult.error ||= decoded.reason || undefined;
      }
    } catch (e: any) {
      logger.error(`cannot liquidate: ${e}`);
      optimisticResult.error =
        (await errorDecoder.decode(e)).reason || undefined;
    }

    optimisticResult.duration = Date.now() - start;
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
  protected async saveTxTrace(txHash: string): Promise<void> {
    try {
      const txTrace = await (this.provider as JsonRpcProvider).send(
        "trace_transaction",
        [txHash],
      );
      await this.outputWriter.write(txHash, txTrace);
      this.log.debug(`saved trace_transaction result for ${txHash}`);
    } catch (e) {
      this.log.warn(`failed to save tx trace: ${e}`);
    }
  }

  protected etherscan({ hash }: TransactionReceipt): string {
    return `${this.#etherscanUrl}/tx/${hash}`;
  }
}
