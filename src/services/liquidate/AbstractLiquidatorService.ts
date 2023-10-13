import type {
  CreditAccountData,
  MultiCall,
  NetworkType,
  PathFinder,
  PathFinderCloseResult,
} from "@gearbox-protocol/sdk";
import {
  detectNetwork,
  IERC20__factory,
  MAINNET_NETWORK,
  tokenSymbolByAddress,
  TxParser,
} from "@gearbox-protocol/sdk";
import type { BigNumber, ethers, providers } from "ethers";
import { utils } from "ethers";
import { Inject } from "typedi";

import config from "../../config";
import type { OptimisticResult } from "../../core/optimistic";
import type { LoggerInterface } from "../../log";
import { AMPQService } from "../ampqService";
import { KeyService } from "../keyService";
import { IOptimisticOutputWriter, OUTPUT_WRITER } from "../output";
import { ISwapper, SWAPPER } from "../swap";
import { mine } from "../utils";
import { OptimisticResults } from "./OptimisiticResults";

export interface Balance {
  underlying: BigNumber;
  eth: BigNumber;
}

export default abstract class AbstractLiquidatorService {
  log: LoggerInterface;

  @Inject()
  keyService: KeyService;

  @Inject()
  ampqService: AMPQService;

  @Inject(OUTPUT_WRITER)
  outputWriter: IOptimisticOutputWriter;

  @Inject(SWAPPER)
  swapper: ISwapper;

  @Inject()
  optimistic: OptimisticResults;

  protected provider: providers.Provider;
  protected pathFinder: PathFinder;
  protected slippage: number;

  protected etherscan = "";
  protected chainId: number;
  protected network: NetworkType;

  /**
   * Launch LiquidatorService
   */
  public async launch(provider: providers.Provider): Promise<void> {
    this.provider = provider;
    this.slippage = Math.floor(config.slippage * 100);

    const { chainId } = await this.provider.getNetwork();
    this.chainId = chainId;
    switch (chainId) {
      case MAINNET_NETWORK:
        this.etherscan = "https://etherscan.io";
        break;
    }

    this.network = await detectNetwork(provider);
  }

  public async liquidate(ca: CreditAccountData): Promise<void> {
    this.ampqService.info(
      `Start liquidation of ${this.getAccountTitle(ca)} with HF ${
        ca.healthFactor
      }`,
    );

    try {
      const pfResult = await this.findClosePath(ca);
      const pathHuman = TxParser.parseMultiCall(pfResult.calls);
      this.log.debug(pathHuman);

      const executor = this.keyService.takeVacantExecutor();
      const tx = await this._liquidate(executor, ca, pfResult.calls, false);
      const receipt = await tx.wait(1);

      this.ampqService.info(
        `Account for borrower ${this.getAccountTitle(
          ca,
        )} was successfully liquidated\nTx receipt: ${this.etherscan}/tx/${
          tx.hash
        }\nGas used: ${receipt.gasUsed
          .toNumber()
          .toLocaleString("en")}\nPath used:\n${pathHuman.join("\n")}`,
      );

      await this.keyService.returnExecutor(executor.address);
    } catch (e) {
      this.ampqService.error(
        `Cant liquidate ${this.getAccountTitle(ca)}: ${e}`,
      );
    }
  }

  protected abstract _liquidate(
    executor: ethers.Wallet,
    account: CreditAccountData,
    calls: MultiCall[],
    optimistic: boolean,
  ): Promise<ethers.ContractTransaction>;

  public async liquidateOptimistic(ca: CreditAccountData): Promise<void> {
    let snapshotId: unknown;
    const optimisticResult: OptimisticResult = {
      creditManager: ca.creditManager,
      borrower: ca.borrower,
      gasUsed: 0,
      calls: [],
      isError: false,
      pathAmount: "0",
      liquidatorPremium: "0",
      liquidatorProfit: "0",
    };
    const start = Date.now();

    try {
      this.log.debug(`Searching path for ${ca.hash()}...`);
      const pfResult = await this.findClosePath(ca);
      optimisticResult.calls = pfResult.calls;
      optimisticResult.pathAmount = pfResult.underlyingBalance.toString();

      const pathHuman = TxParser.parseMultiCall(pfResult.calls);
      this.log.debug({ pathHuman }, "path found");

      const balanceBefore = await this.getExecutorBalance(ca);
      // before actual transaction, try to estimate gas
      // this effectively will load state and contracts from fork origin to anvil
      // so following actual tx should not be slow
      // also tx will act as retry in case of anvil external's error
      try {
        await this._estimate(ca, pfResult.calls);
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
        const tx = await this._liquidate(
          this.keyService.signer,
          ca,
          pfResult.calls,
          true,
        );
        this.log.debug(`Liquidation tx receipt: ${tx.hash}`);
        const receipt = await mine(
          this.provider as ethers.providers.JsonRpcProvider,
          tx,
        );

        let balanceAfter = await this.getExecutorBalance(ca);
        optimisticResult.gasUsed = receipt.gasUsed.toNumber();
        optimisticResult.liquidatorPremium = balanceAfter.underlying
          .sub(balanceBefore.underlying)
          .toString();

        // swap underlying back to ETH
        await this.swapper.swap(
          this.keyService.signer,
          ca.underlyingToken,
          balanceAfter.underlying,
        );
        balanceAfter = await this.getExecutorBalance(ca);
        optimisticResult.liquidatorProfit = balanceAfter.eth
          .sub(balanceBefore.eth)
          .toString();

        if (balanceAfter.eth.lt(balanceBefore.eth)) {
          this.log.warn("negative liquidator profit");
        }
      } catch (e: any) {
        optimisticResult.isError = true;
        this.log.error(`Cant liquidate ${this.getAccountTitle(ca)}: ${e}`);
        await this.saveTxTrace(e.transactionHash);
      }
    } catch (e: any) {
      optimisticResult.isError = true;
      this.log.error(
        { account: this.getAccountTitle(ca) },
        `cannot liquidate: ${e}`,
      );
    }

    optimisticResult.duration = Date.now() - start;
    this.optimistic.push(optimisticResult);

    if (snapshotId) {
      await (this.provider as providers.JsonRpcProvider).send("evm_revert", [
        snapshotId,
      ]);
    }
  }

  protected abstract _estimate(
    account: CreditAccountData,
    calls: MultiCall[],
  ): Promise<void>;

  protected async findClosePath(
    ca: CreditAccountData,
  ): Promise<PathFinderCloseResult> {
    try {
      const result = await this.pathFinder.findBestClosePath(
        ca,
        this.slippage,
        true,
      );
      if (!result) {
        throw new Error("result is empty");
      }
      return result;
    } catch (e) {
      throw new Error(`cant find close path: ${e}`);
    }
  }

  protected async getExecutorBalance(ca: CreditAccountData): Promise<Balance> {
    // using promise.all here sometimes results in anvil being stuck
    const isWeth = tokenSymbolByAddress[ca.underlyingToken] === "WETH";
    const eth = await this.provider.getBalance(this.keyService.address);
    const underlying = isWeth
      ? eth
      : await IERC20__factory.connect(
          ca.underlyingToken,
          this.provider,
        ).balanceOf(this.keyService.address);
    return { eth, underlying };
  }

  protected getAccountTitle(ca: CreditAccountData): string {
    const cmSymbol = tokenSymbolByAddress[ca.underlyingToken];
    return `${ca.addr} of ${ca.borrower} in ${cmSymbol}`;
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
}
