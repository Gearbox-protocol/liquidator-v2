import type { INotificationService } from "@gearbox-protocol/cli-utils";
import type {
  CommonSchema,
  LiqduiatorConfig,
  OptimisticResult,
} from "@gearbox-protocol/liquidator-v2-config";
import type {
  CreditAccountData,
  OnchainSDK,
} from "@gearbox-protocol/sdk/onchain";
import { filterDustUSD } from "@gearbox-protocol/sdk/onchain";
import type { Address } from "viem";
import { DI } from "../../di.js";
import type { ErrorHandler } from "../../errors/index.js";
import type { ILogger } from "../../log/index.js";
import { Logger } from "../../log/index.js";
import type Client from "../Client.js";
import { ServiceStartedNotification } from "../notifier/index.js";
import type { IOptimisticOutputWriter } from "../output/index.js";
import AccountHelper from "./AccountHelper.js";
import type { OptimisticResults } from "./OptimisiticResults.js";

export interface LiquidatorBalances {
  /**
   * Executor balance in gas token
   */
  eth: bigint;
  /**
   * Premium receiver balance in underlying token
   */
  underlying: bigint;
}

export default abstract class AbstractLiquidator<
  TConfig extends CommonSchema,
> extends AccountHelper {
  @Logger("Liquidator")
  logger!: ILogger;

  @DI.Inject(DI.SDK)
  sdk!: OnchainSDK;

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

  @DI.Inject(DI.ErrorHandler)
  errorHandler!: ErrorHandler;

  skipList = new Set<Address>();

  public async launch(asFallback?: boolean): Promise<void> {
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
      liquidatorPremium: 0n,
      gasCost: 0n,
      strategy: "none",
      trackId: "none",
    };
  }
}
