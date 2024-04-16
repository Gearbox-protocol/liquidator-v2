import type { CreditAccountData } from "@gearbox-protocol/sdk";
import {
  IERC20__factory,
  tokenSymbolByAddress,
  TxParser,
} from "@gearbox-protocol/sdk";
import type { BigNumber, BigNumberish, ContractReceipt } from "ethers";
import { providers, utils, Wallet } from "ethers";
import { Inject } from "typedi";

import { CONFIG, ConfigSchema } from "../../config";
import type { LoggerInterface } from "../../log";
import { AddressProviderService } from "../AddressProviderService";
import { AMPQService } from "../ampqService";
import { IOptimisticOutputWriter, OUTPUT_WRITER } from "../output";
import { ISwapper, SWAPPER } from "../swap";
import { accountName, managerName } from "../utils";
import { OptimisticResults } from "./OptimisiticResults";
import type {
  ILiquidationStrategy,
  ILiquidatorService,
  OptimisticResult,
  StrategyPreview,
} from "./types";

export interface Balance {
  underlying: BigNumber;
  eth: BigNumber;
}

export default abstract class AbstractLiquidatorService
  implements ILiquidatorService
{
  log: LoggerInterface;

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

  @Inject()
  provider: providers.Provider;

  @Inject()
  wallet: Wallet;

  protected strategy: ILiquidationStrategy<StrategyPreview>;

  #etherscanUrl = "";

  /**
   * Launch LiquidatorService
   */
  public async launch(): Promise<void> {
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
  }

  public async liquidate(ca: CreditAccountData): Promise<void> {
    const name = accountName(ca);
    this.ampqService.info(
      `start ${this.strategy.name} liquidation of ${name} with HF ${ca.healthFactor}`,
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
        `account ${name} was ${this.strategy.adverb} liquidated\nTx receipt: ${this.etherscan(receipt)}\nGas used: ${receipt.gasUsed
          .toNumber()
          .toLocaleString("en")}\nPath used:\n${pathHuman.join("\n")}`,
      );
    } catch (e) {
      this.ampqService.error(
        `${this.strategy.name} liquidation of ${name} failed: ${e}`,
      );
    }
  }

  public async liquidateOptimistic(ca: CreditAccountData): Promise<boolean> {
    const logger = this.log.child({
      account: ca.addr,
      borrower: ca.borrower,
      manager: managerName(ca),
    });
    let snapshotId: unknown;
    const optimisticResult: OptimisticResult = {
      creditManager: ca.creditManager,
      borrower: ca.borrower,
      account: ca.addr,
      gasUsed: 0,
      calls: [],
      isError: true,
      pathAmount: "0",
      liquidatorPremium: "0",
      liquidatorProfit: "0",
    };
    const start = Date.now();

    try {
      const balanceBefore = await this.getBalance(ca);
      snapshotId = await this.strategy.makeLiquidatable(ca);
      logger.debug({ snapshotId }, "previewing...");
      const preview = await this.strategy.preview(ca);
      logger.debug({ preview });
      optimisticResult.calls = preview.calls;
      optimisticResult.pathAmount = preview.underlyingBalance.toString();

      let pathHuman: Array<string | null> = [];
      try {
        pathHuman = TxParser.parseMultiCall(preview.calls);
      } catch (e) {
        pathHuman = [`${e}`];
      }
      logger.debug({ pathHuman }, "path found");

      let gasLimit: BigNumberish = 29e6;
      // before actual transaction, try to estimate gas
      // this effectively will load state and contracts from fork origin to anvil
      // so following actual tx should not be slow
      // also tx will act as retry in case of anvil external's error
      try {
        gasLimit = await this.strategy.estimate(ca, preview);
      } catch (e: any) {
        if (e.code === utils.Logger.errors.UNPREDICTABLE_GAS_LIMIT) {
          this.log.error(`failed to estimate gas: ${e.reason}`);
        } else {
          this.log.debug(`failed to esitmate gas: ${e.code} ${Object.keys(e)}`);
        }
      }

      // snapshotId might be present if we had to setup liquidation conditions for single account
      // otherwise, not write requests has been made up to this point, and it's safe to take snapshot now
      if (!snapshotId) {
        snapshotId = await (this.provider as providers.JsonRpcProvider).send(
          "evm_snapshot",
          [],
        );
      }
      // Actual liquidation (write requests start here)
      try {
        // this is needed because otherwise it's possible to hit deadlines in uniswap calls
        await (this.provider as providers.JsonRpcProvider).send(
          "anvil_setBlockTimestampInterval",
          [12],
        );
        // send profit to executor address because we're going to use swapper later
        const receipt = await this.strategy.liquidate(ca, preview, gasLimit);
        logger.debug(`Liquidation tx hash: ${receipt.transactionHash}`);
        optimisticResult.isError = receipt.status !== 1;
        const strStatus = optimisticResult.isError ? "failure" : "success";
        logger.debug(
          `Liquidation tx receipt: status=${strStatus} (${
            receipt.status
          }), gas=${receipt.cumulativeGasUsed.toString()}`,
        );

        let balanceAfter = await this.getBalance(ca);
        optimisticResult.gasUsed = receipt.gasUsed.toNumber();
        optimisticResult.liquidatorPremium = balanceAfter.underlying
          .sub(balanceBefore.underlying)
          .toString();

        // swap underlying back to ETH
        await this.swapper.swap(
          this.wallet,
          ca.underlyingToken,
          balanceAfter.underlying,
        );
        balanceAfter = await this.getBalance(ca);
        optimisticResult.liquidatorProfit = balanceAfter.eth
          .sub(balanceBefore.eth)
          .toString();

        if (balanceAfter.eth.lt(balanceBefore.eth)) {
          logger.warn("negative liquidator profit");
        }
      } catch (e: any) {
        logger.error(`cant liquidate: ${e}`);
        await this.saveTxTrace(e.transactionHash);
      }
    } catch (e: any) {
      this.log.error(`cannot liquidate: ${e}`);
    }

    optimisticResult.duration = Date.now() - start;
    this.optimistic.push(optimisticResult);

    if (snapshotId) {
      await (this.provider as providers.JsonRpcProvider).send("evm_revert", [
        snapshotId,
      ]);
    }

    return !optimisticResult.isError;
  }

  protected async getBalance(ca: CreditAccountData): Promise<Balance> {
    // using promise.all here sometimes results in anvil being stuck
    const isWeth = tokenSymbolByAddress[ca.underlyingToken] === "WETH";
    const eth = await this.provider.getBalance(this.wallet.address);
    const underlying = isWeth
      ? eth
      : await IERC20__factory.connect(
          ca.underlyingToken,
          this.provider,
        ).balanceOf(this.wallet.address);
    return { eth, underlying };
  }

  /**
   * Safely tries to save trace of failed transaction to configured output
   * @param txHash
   * @returns
   */
  protected async saveTxTrace(txHash: string): Promise<void> {
    try {
      const txTrace = await (this.provider as providers.JsonRpcProvider).send(
        "trace_transaction",
        [txHash],
      );
      await this.outputWriter.write(txHash, txTrace);
      this.log.debug(`saved trace_transaction result for ${txHash}`);
    } catch (e) {
      this.log.warn(`failed to save tx trace: ${e}`);
    }
  }

  protected etherscan(receipt: ContractReceipt): string {
    return `${this.#etherscanUrl}/tx/${receipt.transactionHash}`;
  }
}
