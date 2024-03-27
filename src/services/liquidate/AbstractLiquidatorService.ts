import type { CreditAccountData, MultiCall } from "@gearbox-protocol/sdk";
import {
  IERC20__factory,
  tokenSymbolByAddress,
  TxParser,
} from "@gearbox-protocol/sdk";
import type { PathFinderV1CloseResult } from "@gearbox-protocol/sdk/lib/pathfinder/v1/core";
import type { BigNumber, ethers, providers } from "ethers";
import { utils } from "ethers";
import { Inject } from "typedi";

import config from "../../config";
import type { OptimisticResult } from "../../core/optimistic";
import type { LoggerInterface } from "../../log";
import { AddressProviderService } from "../AddressProviderService";
import { AMPQService } from "../ampqService";
import { KeyService } from "../keyService";
import { IOptimisticOutputWriter, OUTPUT_WRITER } from "../output";
import { ISwapper, SWAPPER } from "../swap";
import { mine } from "../utils";
import { OptimisticResults } from "./OptimisiticResults";
import type { ILiquidatorService, PartialLiquidationPreview } from "./types";

export interface Balance {
  underlying: BigNumber;
  eth: BigNumber;
}

export default abstract class AbstractLiquidatorService
  implements ILiquidatorService
{
  log: LoggerInterface;

  @Inject()
  keyService: KeyService;

  @Inject()
  ampqService: AMPQService;

  @Inject()
  addressProvider: AddressProviderService;

  @Inject(OUTPUT_WRITER)
  outputWriter: IOptimisticOutputWriter;

  @Inject(SWAPPER)
  swapper: ISwapper;

  @Inject()
  optimistic: OptimisticResults;

  protected provider: providers.Provider;
  protected slippage: number;

  #etherscanUrl = "";

  /**
   * Launch LiquidatorService
   */
  public async launch(provider: providers.Provider): Promise<void> {
    this.provider = provider;
    this.slippage = Math.floor(config.slippage * 100);

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
    const name = this.getAccountTitle(ca);
    const kind = config.partialLiquidatorAddress ? "partial" : "full";
    this.ampqService.info(
      `start ${kind} liquidation of ${name} with HF ${ca.healthFactor}`,
    );
    const executor = this.keyService.takeVacantExecutor();
    try {
      if (config.partialLiquidatorAddress) {
        await this.#liquidatePartially(ca, executor);
      } else {
        await this.#liquidateFully(ca, executor);
      }
    } catch (e) {
      this.ampqService.error(`${kind} liquidation of ${name} failed: ${e}`);
    } finally {
      await this.keyService.returnExecutor(executor.address);
    }
  }

  async #liquidateFully(
    ca: CreditAccountData,
    executor: ethers.Wallet,
  ): Promise<void> {
    const pfResult = await this._findClosePath(ca);
    let pathHuman: Array<string | null> = [];
    try {
      pathHuman = TxParser.parseMultiCall(pfResult.calls);
    } catch (e) {
      pathHuman = [`${e}`];
    }
    this.log.debug(pathHuman);

    const tx = await this._liquidateFully(executor, ca, pfResult.calls, false);
    const receipt = await tx.wait(1);

    this.ampqService.info(
      `account ${this.getAccountTitle(ca)} was fully liquidated\nTx receipt: ${this.etherscan(tx)}\nGas used: ${receipt.gasUsed
        .toNumber()
        .toLocaleString("en")}\nPath used:\n${pathHuman.join("\n")}`,
    );
  }

  async #liquidatePartially(
    ca: CreditAccountData,
    executor: ethers.Wallet,
  ): Promise<void> {
    const preview = await this._previewPartialLiquidation(ca);
    let pathHuman: Array<string | null> = [];
    try {
      pathHuman = TxParser.parseMultiCall(preview.conversionCalls);
    } catch (e) {
      pathHuman = [`${e}`];
    }
    this.log.debug(pathHuman);

    const tx = await this._liquidatePartially(executor, ca, preview, false);
    const receipt = await tx.wait(1);

    this.ampqService.info(
      `account ${this.getAccountTitle(ca)} was partially liquidated\nTx receipt: ${this.etherscan(tx)}\nGas used: ${receipt.gasUsed
        .toNumber()
        .toLocaleString("en")}\nPath used:\n${pathHuman.join("\n")}`,
    );
  }

  public async liquidateOptimistic(ca: CreditAccountData): Promise<boolean> {
    if (config.partialLiquidatorAddress) {
      return this.#liquidatePartiallyOptimistic(ca);
    } else {
      return this.#liquidateFullyOptimistic(ca);
    }
  }

  async #liquidateFullyOptimistic(ca: CreditAccountData): Promise<boolean> {
    let snapshotId: unknown;
    let executor: ethers.Wallet | undefined;
    // address that will receive profit from liquidation
    // there's a bit of confusion between "keyService" address and actual executor address
    // so use this variable to be more explicit
    let recipient: string | undefined;
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
      executor = this.keyService.takeVacantExecutor();
      recipient = executor.address;
      const balanceBefore = await this.getBalance(recipient, ca);
      this.log.debug(
        `Searching path for acc ${ca.addr} in ${ca.creditManager}...`,
      );
      const pfResult = await this._findClosePath(ca);
      optimisticResult.calls = pfResult.calls;
      optimisticResult.pathAmount = pfResult.underlyingBalance.toString();

      let pathHuman: Array<string | null> = [];
      try {
        pathHuman = TxParser.parseMultiCall(pfResult.calls);
      } catch (e) {
        pathHuman = [`${e}`];
      }
      this.log.debug({ pathHuman }, "path found");

      // before actual transaction, try to estimate gas
      // this effectively will load state and contracts from fork origin to anvil
      // so following actual tx should not be slow
      // also tx will act as retry in case of anvil external's error
      try {
        await this._estimate(executor, ca, pfResult.calls, recipient);
      } catch (e: any) {
        if (e.code === utils.Logger.errors.UNPREDICTABLE_GAS_LIMIT) {
          this.log.error(`failed to estimate gas: ${e.reason}`);
        } else {
          this.log.debug(`failed to esitmate gas: ${e.code} ${Object.keys(e)}`);
        }
      }

      // save snapshot after all read requests are done
      snapshotId = await (this.provider as providers.JsonRpcProvider).send(
        "evm_snapshot",
        [],
      );
      // Actual liquidation (write requests start here)
      try {
        // this is needed because otherwise it's possible to hit deadlines in uniswap calls
        await (this.provider as providers.JsonRpcProvider).send(
          "anvil_setBlockTimestampInterval",
          [12],
        );
        // send profit to executor address because we're going to use swapper later
        const tx = await this._liquidateFully(
          executor,
          ca,
          pfResult.calls,
          true,
          recipient,
        );
        this.log.debug(`Liquidation tx hash: ${tx.hash}`);
        const receipt = await mine(
          this.provider as ethers.providers.JsonRpcProvider,
          tx,
        );
        optimisticResult.isError = receipt.status !== 1;
        const strStatus = optimisticResult.isError ? "failure" : "success";
        this.log.debug(
          `Liquidation tx receipt: status=${strStatus} (${
            receipt.status
          }), gas=${receipt.cumulativeGasUsed.toString()}`,
        );

        let balanceAfter = await this.getBalance(recipient, ca);
        optimisticResult.gasUsed = receipt.gasUsed.toNumber();
        optimisticResult.liquidatorPremium = balanceAfter.underlying
          .sub(balanceBefore.underlying)
          .toString();

        // swap underlying back to ETH
        await this.swapper.swap(
          executor,
          ca.underlyingToken,
          balanceAfter.underlying,
          recipient,
        );
        balanceAfter = await this.getBalance(recipient, ca);
        optimisticResult.liquidatorProfit = balanceAfter.eth
          .sub(balanceBefore.eth)
          .toString();

        if (balanceAfter.eth.lt(balanceBefore.eth)) {
          this.log.warn("negative liquidator profit");
        }
      } catch (e: any) {
        this.log.error(`Cant liquidate ${this.getAccountTitle(ca)}: ${e}`);
        await this.saveTxTrace(e.transactionHash);
      }
    } catch (e: any) {
      this.log.error(
        { account: this.getAccountTitle(ca) },
        `cannot liquidate: ${e}`,
      );
    }

    optimisticResult.duration = Date.now() - start;
    this.optimistic.push(optimisticResult);

    if (executor) {
      await this.keyService.returnExecutor(executor.address, false);
    }

    if (snapshotId) {
      await (this.provider as providers.JsonRpcProvider).send("evm_revert", [
        snapshotId,
      ]);
    }

    return !optimisticResult.isError;
  }

  async #liquidatePartiallyOptimistic(ca: CreditAccountData): Promise<boolean> {
    let snapshotId: unknown;
    let executor: ethers.Wallet | undefined;
    // address that will receive profit from liquidation
    // there's a bit of confusion between "keyService" address and actual executor address
    // so use this variable to be more explicit
    let recipient: string | undefined;
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
      executor = this.keyService.takeVacantExecutor();
      recipient = executor.address;
      const balanceBefore = await this.getBalance(recipient, ca);
      this.log.debug(
        `previewing partial liquidation for ${this.getAccountTitle(ca)}...`,
      );
      const preview = await this._previewPartialLiquidation(ca);
      optimisticResult.calls = preview.conversionCalls;
      optimisticResult.pathAmount = "0"; // TODO: find out

      let pathHuman: Array<string | null> = [];
      try {
        pathHuman = TxParser.parseMultiCall(preview.conversionCalls);
      } catch (e) {
        pathHuman = [`${e}`];
      }
      this.log.debug({ pathHuman }, "preview calls");

      // before actual transaction, try to estimate gas
      // this effectively will load state and contracts from fork origin to anvil
      // so following actual tx should not be slow
      // also tx will act as retry in case of anvil external's error
      try {
        await this._estimatePartially(executor, ca, preview, recipient);
      } catch (e: any) {
        if (e.code === utils.Logger.errors.UNPREDICTABLE_GAS_LIMIT) {
          this.log.error(`failed to estimate gas: ${e.reason}`);
        } else {
          this.log.debug(`failed to esitmate gas: ${e.code} ${Object.keys(e)}`);
        }
      }

      // save snapshot after all read requests are done
      snapshotId = await (this.provider as providers.JsonRpcProvider).send(
        "evm_snapshot",
        [],
      );
      // Actual liquidation (write requests start here)
      try {
        // this is needed because otherwise it's possible to hit deadlines in uniswap calls
        await (this.provider as providers.JsonRpcProvider).send(
          "anvil_setBlockTimestampInterval",
          [12],
        );
        // send profit to executor address because we're going to use swapper later
        const tx = await this._liquidatePartially(
          executor,
          ca,
          preview,
          true,
          recipient,
        );
        this.log.debug(`Liquidation tx hash: ${tx.hash}`);
        const receipt = await mine(
          this.provider as ethers.providers.JsonRpcProvider,
          tx,
        );
        optimisticResult.isError = receipt.status !== 1;
        const strStatus = optimisticResult.isError ? "failure" : "success";
        this.log.debug(
          `Liquidation tx receipt: status=${strStatus} (${
            receipt.status
          }), gas=${receipt.cumulativeGasUsed.toString()}`,
        );

        let balanceAfter = await this.getBalance(recipient, ca);
        optimisticResult.gasUsed = receipt.gasUsed.toNumber();
        optimisticResult.liquidatorPremium = balanceAfter.underlying
          .sub(balanceBefore.underlying)
          .toString();

        // swap underlying back to ETH
        await this.swapper.swap(
          executor,
          ca.underlyingToken,
          balanceAfter.underlying,
          recipient,
        );
        balanceAfter = await this.getBalance(recipient, ca);
        optimisticResult.liquidatorProfit = balanceAfter.eth
          .sub(balanceBefore.eth)
          .toString();

        if (balanceAfter.eth.lt(balanceBefore.eth)) {
          this.log.warn("negative liquidator profit");
        }
      } catch (e: any) {
        this.log.error(`Cant liquidate ${this.getAccountTitle(ca)}: ${e}`);
        await this.saveTxTrace(e.transactionHash);
      }
    } catch (e: any) {
      this.log.error(
        { account: this.getAccountTitle(ca) },
        `cannot liquidate: ${e}`,
      );
    }

    optimisticResult.duration = Date.now() - start;
    this.optimistic.push(optimisticResult);

    if (executor) {
      await this.keyService.returnExecutor(executor.address, false);
    }

    if (snapshotId) {
      await (this.provider as providers.JsonRpcProvider).send("evm_revert", [
        snapshotId,
      ]);
    }

    return !optimisticResult.isError;
  }

  protected abstract _estimate(
    executor: ethers.Wallet,
    account: CreditAccountData,
    calls: MultiCall[],
    recipient?: string,
  ): Promise<void>;

  protected abstract _estimatePartially(
    executor: ethers.Wallet,
    account: CreditAccountData,
    preview: PartialLiquidationPreview,
    recipient?: string,
  ): Promise<void>;

  protected abstract _liquidateFully(
    executor: ethers.Wallet,
    account: CreditAccountData,
    calls: MultiCall[],
    optimistic: boolean,
    recipient?: string,
  ): Promise<ethers.ContractTransaction>;

  protected abstract _liquidatePartially(
    executor: ethers.Wallet,
    account: CreditAccountData,
    preview: PartialLiquidationPreview,
    optimistic: boolean,
    recipient?: string,
  ): Promise<ethers.ContractTransaction>;

  protected abstract _findClosePath(
    ca: CreditAccountData,
  ): Promise<PathFinderV1CloseResult>;

  protected abstract _previewPartialLiquidation(
    ca: CreditAccountData,
  ): Promise<PartialLiquidationPreview>;

  protected async getBalance(
    address: string,
    ca: CreditAccountData,
  ): Promise<Balance> {
    // using promise.all here sometimes results in anvil being stuck
    const isWeth = tokenSymbolByAddress[ca.underlyingToken] === "WETH";
    const eth = await this.provider.getBalance(address);
    const underlying = isWeth
      ? eth
      : await IERC20__factory.connect(
          ca.underlyingToken,
          this.provider,
        ).balanceOf(address);
    return { eth, underlying };
  }

  protected getAccountTitle(ca: CreditAccountData): string {
    const cmSymbol = tokenSymbolByAddress[ca.underlyingToken];
    return `${ca.addr} of ${ca.borrower} in ${ca.creditManager} (${cmSymbol})`;
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

  protected etherscan(tx: { hash: string }): string {
    return `${this.#etherscanUrl}/tx/${tx.hash}`;
  }
}
