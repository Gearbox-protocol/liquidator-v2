import { tokenSymbolByAddress } from "@gearbox-protocol/sdk-gov";
import {
  iDataCompressorV3Abi,
  ierc20MetadataAbi,
} from "@gearbox-protocol/types/abi";
import type { OptimisticResult } from "@gearbox-protocol/types/optimist";
import type { Address, TransactionReceipt } from "viem";
import { getContract } from "viem";

import type { Config } from "../../config/index.js";
import { CreditAccountData, CreditManagerData } from "../../data/index.js";
import { DI } from "../../di.js";
import { ErrorHandler } from "../../errors/index.js";
import type { ILogger } from "../../log/index.js";
import { Logger } from "../../log/index.js";
import { PathFinder } from "../../utils/ethers-6-temp/pathfinder/index.js";
import { TxParserHelper } from "../../utils/ethers-6-temp/txparser/index.js";
import type { IDataCompressorContract } from "../../utils/index.js";
import type { AddressProviderService } from "../AddressProviderService.js";
import type Client from "../Client.js";
import {
  AlertBucket,
  type INotifier,
  StartedMessage,
} from "../notifier/index.js";
import type OracleServiceV3 from "../OracleServiceV3.js";
import type { IOptimisticOutputWriter } from "../output/index.js";
import type { RedstoneServiceV3 } from "../RedstoneServiceV3.js";
import type { ISwapper } from "../swap/index.js";
import type { OptimisticResults } from "./OptimisiticResults.js";
import type { StrategyPreview } from "./types.js";

export default abstract class AbstractLiquidator {
  @Logger("Liquidator")
  logger!: ILogger;

  @DI.Inject(DI.Redstone)
  redstone!: RedstoneServiceV3;

  @DI.Inject(DI.Notifier)
  notifier!: INotifier;

  @DI.Inject(DI.Config)
  config!: Config;

  @DI.Inject(DI.AddressProvider)
  addressProvider!: AddressProviderService;

  @DI.Inject(DI.Oracle)
  oracle!: OracleServiceV3;

  @DI.Inject(DI.Output)
  outputWriter!: IOptimisticOutputWriter;

  @DI.Inject(DI.Swapper)
  swapper!: ISwapper;

  @DI.Inject(DI.OptimisticResults)
  optimistic!: OptimisticResults;

  @DI.Inject(DI.Client)
  client!: Client;

  skipList = new Set<Address>();

  #errorHandler?: ErrorHandler;
  #compressor?: IDataCompressorContract;
  #pathFinder?: PathFinder;
  #router?: Address;
  #cmCache: Record<string, CreditManagerData> = {};

  protected alertBuckets = new Map<Address, AlertBucket>();

  public async launch(asFallback?: boolean): Promise<void> {
    this.#errorHandler = new ErrorHandler(this.config, this.logger);
    const [pfAddr, dcAddr] = [
      this.addressProvider.findService("ROUTER", 300),
      this.addressProvider.findService("DATA_COMPRESSOR", 300),
    ];
    this.#router = pfAddr;
    this.#compressor = getContract({
      abi: iDataCompressorV3Abi,
      address: dcAddr,
      client: this.client.pub,
    });
    this.#pathFinder = new PathFinder(
      pfAddr,
      this.client.pub,
      this.config.network,
    );
    if (!asFallback) {
      this.notifier.notify(new StartedMessage());
    }
  }

  protected newOptimisticResult(acc: CreditAccountData): OptimisticResult {
    return {
      creditManager: acc.creditManager,
      borrower: acc.borrower,
      account: acc.addr,
      balancesBefore: acc.filterDust(),
      hfBefore: Number(acc.healthFactor),
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
  }

  protected updateAfterPreview(
    result: OptimisticResult,
    preview: StrategyPreview,
  ): OptimisticResult {
    return {
      ...result,
      assetOut: preview.assetOut,
      amountOut: preview.amountOut,
      flashLoanAmount: preview.flashLoanAmount,
      calls: preview.calls,
      pathAmount: preview.underlyingBalance.toString(),
      priceUpdates: preview.priceUpdates,
      callsHuman: TxParserHelper.parseMultiCall(preview),
    };
  }

  protected async updateAfterLiquidation(
    result: OptimisticResult,
    acc: CreditAccountData,
    underlyingBalanceBefore: bigint,
    receipt: TransactionReceipt,
  ): Promise<OptimisticResult> {
    const ca = await this.updateCreditAccountData(acc);
    result.balancesAfter = ca.filterDust();
    result.hfAfter = Number(ca.healthFactor);

    const balanceAfter = await this.getExecutorBalance(ca.underlyingToken);
    result.gasUsed = Number(receipt.gasUsed);
    result.liquidatorPremium = (
      balanceAfter.underlying - underlyingBalanceBefore
    ).toString(10);
    return result;
  }

  protected async getCreditManagerData(
    addr: Address,
  ): Promise<CreditManagerData> {
    let cm: CreditManagerData | undefined;
    if (this.config.optimistic) {
      cm = this.#cmCache[addr.toLowerCase()];
    }
    if (!cm) {
      cm = new CreditManagerData(
        await this.compressor.read.getCreditManagerData([addr]),
      );
      if (this.config.optimistic) {
        this.#cmCache[addr.toLowerCase()] = cm;
      }
    }
    // TODO: TxParser is really old and weird class, until we refactor it it's the best place to have this
    TxParserHelper.addCreditManager(cm);
    return cm;
  }

  protected async getCreditManagersV3List(): Promise<CreditManagerData[]> {
    const raw = await this.compressor.read.getCreditManagersV3List();
    const result = raw.map(d => new CreditManagerData(d));

    for (const cm of result) {
      TxParserHelper.addCreditManager(cm);
      if (this.config.optimistic) {
        this.#cmCache[cm.address.toLowerCase()] = cm;
      }
    }

    return result;
  }

  /**
   * Fetches credit account data again for optimistic report
   * @param ca
   * @returns
   */
  protected async updateCreditAccountData(
    ca: CreditAccountData,
  ): Promise<CreditAccountData> {
    if (!this.config.optimistic) {
      throw new Error(
        "updateCreditAccountData should only be used in optimistic mode",
      );
    }
    const priceUpdates = await this.redstone.dataCompressorUpdates(ca);
    const { result } = await this.compressor.simulate.getCreditAccountData([
      ca.addr,
      priceUpdates,
    ]);
    return new CreditAccountData(result);
  }

  protected async getExecutorBalance(
    underlyingToken: Address,
  ): Promise<{ eth: bigint; underlying: bigint }> {
    // using promise.all here sometimes results in anvil being stuck
    const isWeth = tokenSymbolByAddress[underlyingToken] === "WETH";
    const eth = await this.client.pub.getBalance({
      address: this.client.address,
    });
    const underlying = isWeth
      ? eth
      : await this.client.pub.readContract({
          address: underlyingToken,
          abi: ierc20MetadataAbi,
          functionName: "balanceOf",
          args: [this.client.address],
        });
    return { eth, underlying };
  }

  protected getAlertBucket(ca: CreditAccountData): AlertBucket {
    const acc = ca.addr.toLowerCase() as Address;
    if (!this.alertBuckets.has(acc)) {
      this.alertBuckets.set(
        acc,
        new AlertBucket([0, 60_000, 10 * 60_000, 30 * 60_000]),
      );
    }
    return this.alertBuckets.get(acc)!;
  }

  protected get errorHandler(): ErrorHandler {
    if (!this.#errorHandler) {
      throw new Error("liquidator not launched");
    }
    return this.#errorHandler;
  }

  protected get compressor(): IDataCompressorContract {
    if (!this.#compressor) {
      throw new Error("liquidator not launched");
    }
    return this.#compressor;
  }

  protected get pathFinder(): PathFinder {
    if (!this.#pathFinder) {
      throw new Error("liquidator not launched");
    }
    return this.#pathFinder;
  }

  protected get router(): Address {
    if (!this.#router) {
      throw new Error("liquidator not launched");
    }
    return this.#router;
  }
}
