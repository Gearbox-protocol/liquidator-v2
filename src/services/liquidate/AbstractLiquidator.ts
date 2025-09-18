import type {
  CreditAccountData,
  GearboxSDK,
  ICreditAccountsService,
  MultiCall,
  VersionRange,
} from "@gearbox-protocol/sdk";
import { filterDust, isVersionRange } from "@gearbox-protocol/sdk";
import { ierc20MetadataAbi } from "@gearbox-protocol/types/abi";
import type { OptimisticResult } from "@gearbox-protocol/types/optimist";
import type { Address, TransactionReceipt } from "viem";

import type { CommonSchema, LiqduiatorConfig } from "../../config/index.js";
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

export default abstract class AbstractLiquidator<TConfig extends CommonSchema> {
  @Logger("Liquidator")
  logger!: ILogger;

  @DI.Inject(DI.CreditAccountService)
  creditAccountService!: ICreditAccountsService;

  @DI.Inject(DI.Notifier)
  notifier!: INotifier;

  @DI.Inject(DI.Config)
  config!: LiqduiatorConfig<TConfig>;

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

  public async launch(asFallback?: boolean): Promise<void> {
    this.#errorHandler = new ErrorHandler(this.config, this.logger);
    if (!asFallback) {
      this.notifier.notify(new StartedMessage());
    }
  }

  protected newOptimisticResult(
    acc: CreditAccountData,
  ): OptimisticResult<bigint> {
    return {
      creditManager: acc.creditManager,
      borrower: acc.owner,
      account: acc.creditAccount,
      balancesBefore: filterDust(acc),
      hfBefore: BigInt(acc.healthFactor),
      balancesAfter: {},
      hfAfter: 0n,
      gasUsed: 0n,
      calls: [],
      callsHuman: [],
      isError: true,
      pathAmount: 0n,
      liquidatorPremium: 0n,
      liquidatorProfit: 0n,
    };
  }

  protected updateAfterPreview(
    result: OptimisticResult<bigint>,
    preview: StrategyPreview,
  ): OptimisticResult<bigint> {
    return {
      ...result,
      assetOut: preview.assetOut,
      amountOut: preview.amountOut,
      flashLoanAmount: preview.flashLoanAmount,
      calls: preview.calls as MultiCall[],
      pathAmount: preview.underlyingBalance,
      callsHuman: this.creditAccountService.sdk.parseMultiCall(
        preview.calls as MultiCall[],
      ),
    };
  }

  protected async updateAfterLiquidation(
    result: OptimisticResult<bigint>,
    acc: CreditAccountData,
    underlyingBalanceBefore: bigint,
    receipt: TransactionReceipt,
  ): Promise<OptimisticResult<bigint>> {
    const ca = await this.creditAccountService.getCreditAccountData(
      acc.creditAccount,
    );
    if (!ca) {
      throw new Error(`account ${acc.creditAccount} not found`);
    }
    result.balancesAfter = filterDust(ca);
    result.hfAfter = ca.healthFactor;

    const balanceAfter = await this.getExecutorBalance(ca.underlying);
    result.gasUsed = receipt.gasUsed;
    result.liquidatorPremium =
      balanceAfter.underlying - underlyingBalanceBefore;
    return result;
  }

  protected async getExecutorBalance(
    underlyingToken: Address,
  ): Promise<{ eth: bigint; underlying: bigint }> {
    // TODO: is this needed?
    const isWeth = this.sdk.tokensMeta.symbol(underlyingToken) === "WETH";
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

  protected checkAccountVersion(
    ca: CreditAccountData,
    v: VersionRange,
  ): boolean {
    return isVersionRange(
      this.sdk.contracts.mustGet(ca.creditFacade).version,
      v,
    );
  }
}
