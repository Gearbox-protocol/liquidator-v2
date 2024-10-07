import type {
  CreditAccountData,
  CreditAccountsService,
  GearboxSDK,
} from "@gearbox-protocol/sdk";
import { filterDust } from "@gearbox-protocol/sdk";
import { ierc20Abi } from "@gearbox-protocol/types/abi";
import type { OptimisticResult } from "@gearbox-protocol/types/optimist";
import type { Address, TransactionReceipt } from "viem";

import type { Config } from "../../config/index.js";
import { DI } from "../../di.js";
import { ErrorHandler } from "../../errors/index.js";
import type { ILogger } from "../../log/index.js";
import { Logger } from "../../log/index.js";
import type Client from "../Client.js";
import { type INotifier, StartedMessage } from "../notifier/index.js";
import type { IOptimisticOutputWriter } from "../output/index.js";
import type { ISwapper } from "../swap/index.js";
import type { OptimisticResults } from "./OptimisiticResults.js";
import type { StrategyPreview } from "./types.js";

export default abstract class AbstractLiquidator {
  @Logger("Liquidator")
  logger!: ILogger;

  @DI.Inject(DI.CreditAccountService)
  creditAccountService!: CreditAccountsService;

  @DI.Inject(DI.Notifier)
  notifier!: INotifier;

  @DI.Inject(DI.Config)
  config!: Config;

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

  public async launch(): Promise<void> {
    this.#errorHandler = new ErrorHandler(this.config, this.logger);
    this.notifier.notify(new StartedMessage());
  }

  protected newOptimisticResult(acc: CreditAccountData): OptimisticResult {
    return {
      creditManager: acc.creditManager,
      borrower: acc.owner,
      account: acc.creditAccount,
      balancesBefore: filterDust(acc),
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
      callsHuman: [], // this.creditAccountService.sdk.parseMultiCall(preview.calls),
    };
  }

  protected async updateAfterLiquidation(
    result: OptimisticResult,
    acc: CreditAccountData,
    underlyingBalanceBefore: bigint,
    receipt: TransactionReceipt,
  ): Promise<OptimisticResult> {
    const ca = await this.creditAccountService.getCreditAccountData(
      acc.creditAccount,
    );
    if (!ca) {
      throw new Error(`account ${acc.creditAccount} not found`);
    }
    result.balancesAfter = filterDust(ca);
    result.hfAfter = Number(ca.healthFactor);

    const balanceAfter = await this.getExecutorBalance(ca.underlying);
    result.gasUsed = Number(receipt.gasUsed);
    result.liquidatorPremium = (
      balanceAfter.underlying - underlyingBalanceBefore
    ).toString(10);
    return result;
  }

  protected async getExecutorBalance(
    underlyingToken: Address,
  ): Promise<{ eth: bigint; underlying: bigint }> {
    // TODO: is this needed?
    const token = this.sdk.marketRegister.tokensMeta.mustGet(underlyingToken);
    const isWeth = token.symbol === "WETH";
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

  protected caLogger(ca: CreditAccountData): ILogger {
    const cm = this.sdk.marketRegister.findCreditManager(ca.creditManager);
    return this.logger.child({
      account: ca.creditAccount,
      borrower: ca.owner,
      manager: cm.name,
      hf: ca.healthFactor,
    });
  }

  protected get sdk(): GearboxSDK {
    return this.creditAccountService.sdk;
  }

  protected get errorHandler(): ErrorHandler {
    if (!this.#errorHandler) {
      throw new Error("liquidator not launched");
    }
    return this.#errorHandler;
  }
}
