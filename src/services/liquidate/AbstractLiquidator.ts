import type { INotificationService } from "@gearbox-protocol/cli-utils";
import type {
  CreditAccountData,
  GearboxSDK,
  ICreditAccountsService,
} from "@gearbox-protocol/sdk";
import { filterDustUSD } from "@gearbox-protocol/sdk";
import type { OptimisticResult } from "@gearbox-protocol/types/optimist";
import { type Address, erc20Abi } from "viem";
import type { CommonSchema, LiqduiatorConfig } from "../../config/index.js";
import { DI } from "../../di.js";
import { ErrorHandler } from "../../errors/index.js";
import type { ILogger } from "../../log/index.js";
import { Logger } from "../../log/index.js";
import type Client from "../Client.js";
import { ServiceStartedNotification } from "../notifier/index.js";
import type { IOptimisticOutputWriter } from "../output/index.js";
import AccountHelper from "./AccountHelper.js";
import type { OptimisticResults } from "./OptimisiticResults.js";

export interface ExecutorBalance {
  eth: bigint;
  underlying: bigint;
}

export default abstract class AbstractLiquidator<
  TConfig extends CommonSchema,
> extends AccountHelper {
  @Logger("Liquidator")
  logger!: ILogger;

  @DI.Inject(DI.CreditAccountService)
  creditAccountService!: ICreditAccountsService;

  @DI.Inject(DI.Notifier)
  notifier!: INotificationService;

  @DI.Inject(DI.Config)
  config!: LiqduiatorConfig<TConfig>;

  @DI.Inject(DI.Output)
  outputWriter!: IOptimisticOutputWriter;

  @DI.Inject(DI.OptimisticResults)
  optimistic!: OptimisticResults;

  @DI.Inject(DI.Client)
  client!: Client;

  skipList = new Set<Address>();

  #errorHandler?: ErrorHandler;

  public async launch(asFallback?: boolean): Promise<void> {
    this.#errorHandler = new ErrorHandler(this.config, this.logger);
    if (!asFallback) {
      this.notifier.notify(new ServiceStartedNotification());
    }
  }

  protected newOptimisticResult(
    acc: CreditAccountData,
  ): OptimisticResult<bigint> {
    return {
      creditManager: acc.creditManager,
      borrower: acc.owner,
      account: acc.creditAccount,
      balancesBefore: filterDustUSD({ account: acc, sdk: this.sdk }),
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

  protected async getExecutorBalance(
    underlyingToken: Address,
  ): Promise<ExecutorBalance> {
    const eth = await this.client.pub.getBalance({
      address: this.client.address,
    });
    const underlying = await this.client.pub.readContract({
      address: underlyingToken,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [this.client.address],
    });
    return { eth, underlying };
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
