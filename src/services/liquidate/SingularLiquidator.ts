import {
  type CreditAccountData,
  filterDustUSD,
  type MultiCall,
} from "@gearbox-protocol/sdk";
import type { OptimisticResult } from "@gearbox-protocol/types/optimist";
import type { Hex, TransactionReceipt } from "viem";
import type {
  CommonSchema,
  FullLiquidatorSchema,
  PartialLiquidatorSchema,
} from "../../config/index.js";
import { TransactionRevertedError } from "../../errors/index.js";
import { LoggerFactory } from "../../log/index.js";
import {
  LiquidationErrorMessage,
  LiquidationStartMessage,
  LiquidationSuccessMessage,
} from "../notifier/index.js";
import AbstractLiquidator, {
  type ExecutorBalance,
} from "./AbstractLiquidator.js";
import LiquidationStrategyFull from "./LiquidationStrategyFull.js";
import LiquidationStrategyPartial from "./LiquidationStrategyPartial.js";
import type {
  ILiquidationStrategy,
  ILiquidatorService,
  LiquidationPreview,
} from "./types.js";

type OptimisticStrategyResult = {
  preview?: LiquidationPreview;
  receipt?: TransactionReceipt;
} & (
  | { success: true; state: CreditAccountData; balancesAfter: ExecutorBalance }
  | { success: false; error: Error }
);

export default class SingularLiquidator
  extends AbstractLiquidator<CommonSchema>
  implements ILiquidatorService
{
  #strategies: ILiquidationStrategy[] = [];

  constructor() {
    super();
    const add = (s: any) => {
      this.#strategies.push(s);
    };
    const liquidationMode = this.config.liquidationMode ?? "full";
    switch (liquidationMode) {
      case "full": {
        const cfg = this.config as unknown as FullLiquidatorSchema;
        switch (cfg.lossPolicy) {
          case "only":
            add(new LiquidationStrategyFull("loss policy", true));
            return;
          case "never":
            add(new LiquidationStrategyFull("full", false));
            return;
          case "fallback":
            add(new LiquidationStrategyFull("loss policy", true));
            add(new LiquidationStrategyFull("full fallback", false));
            return;
        }
        return;
      }
      case "deleverage":
      case "partial": {
        const cfg = this.config as unknown as PartialLiquidatorSchema;
        add(new LiquidationStrategyPartial());
        if (cfg.partialFallback) {
          add(new LiquidationStrategyFull("full fallback"));
        }
        return;
      }
    }
  }

  override async launch(): Promise<void> {
    await super.launch();
    this.logger.info(
      `launching strategies: ${this.#strategies.map(s => s.name).join(", ")}`,
    );
    await Promise.all(this.#strategies.map(s => s.launch()));
  }

  public async syncState(_blockNumber: bigint): Promise<void> {
    await Promise.all(this.#strategies.map(s => s.syncState(_blockNumber)));
  }

  public async liquidate(accounts: CreditAccountData[]): Promise<void> {
    if (!accounts.length) {
      return;
    }
    this.logger.warn(`Need to liquidate ${accounts.length} accounts`);
    for (const ca of accounts) {
      LoggerFactory.setLogContext({ account: ca.creditAccount });
      await this.#liquidateOne(ca);
      LoggerFactory.clearLogContext();
      // success or no, silence the notifier for this account for a while
      this.notifier.setCooldown(ca.creditAccount.toLowerCase());
    }
  }

  public async liquidateOptimistic(
    accounts: CreditAccountData[],
  ): Promise<void> {
    const total = accounts.length;
    const debugS = this.config.debugAccount ? "selective " : "";
    this.logger.info(`${debugS}optimistic liquidation for ${total} accounts`);

    for (let i = 0; i < total; i++) {
      const acc = accounts[i];
      LoggerFactory.setLogContext({ account: acc.creditAccount });
      const result = await this.#liquidateOneOptimistic(acc);
      LoggerFactory.clearLogContext();
      const status = result.isError ? "FAIL" : "OK";
      const msg = `[${i + 1}/${total}] ${acc.creditAccount} in ${acc.creditManager} ${status}`;
      if (result.isError) {
        this.logger.warn(msg);
      } else {
        this.logger.info(msg);
      }
    }
    const success = this.optimistic.get().filter(r => !r.isError).length;
    this.logger.info(
      `optimistic liquidation finished: ${success}/${total} accounts liquidated`,
    );
  }

  async #liquidateOne(ca: CreditAccountData): Promise<void> {
    const cm = this.sdk.marketRegister.findCreditManager(ca.creditManager);
    this.logger.debug(
      {
        borrower: ca.owner,
        manager: cm.name,
        hf: ca.healthFactor,
      },
      "liquidating account",
    );
    if (this.skipList.has(ca.creditAccount)) {
      this.logger.warn("skipping this account");
      return;
    }
    let pathHuman: string[] | undefined;
    let skipOnFailure = false;

    this.notifier.notify(new LiquidationStartMessage(ca));

    for (const s of this.#strategies) {
      if (!s.isApplicable(ca)) {
        this.logger.debug(`strategy ${s.name} is not applicable`);
        continue;
      }
      try {
        const preview = await s.preview(ca);
        skipOnFailure ||= !!preview.skipOnFailure;
        pathHuman = this.creditAccountService.sdk.parseMultiCall([
          ...preview.calls,
        ]);
        this.logger.debug({ pathHuman }, "path found");

        const { request } = await s.simulate(ca, preview);
        const receipt = await this.client.liquidate(request);
        if (receipt.status === "success") {
          this.notifier.alert(
            new LiquidationSuccessMessage(ca, s.name, receipt, pathHuman),
          );
          return;
        } else {
          throw new TransactionRevertedError(receipt);
        }
      } catch (e) {
        const decoded = await this.errorHandler.explain(e, ca);
        this.logger.error(
          `cant liquidate with ${s.name}: ${decoded.shortMessage}`,
        );
        this.notifier.alert(
          new LiquidationErrorMessage(
            ca,
            s.name,
            decoded.shortMessage,
            pathHuman,
          ),
        );
      }
    }

    if (skipOnFailure) {
      this.skipList.add(ca.creditAccount);
      this.logger.warn("adding to skip list");
    }
  }

  async #liquidateOneOptimistic(
    acc: CreditAccountData,
  ): Promise<OptimisticResult<bigint>> {
    const cm = this.sdk.marketRegister.findCreditManager(acc.creditManager);
    this.logger.debug(
      {
        borrower: acc.owner,
        manager: cm.name,
        hf: acc.healthFactor,
      },
      "liquidating account",
    );
    const result = this.newOptimisticResult(acc);
    const start = Date.now();
    let strategyResult: OptimisticStrategyResult | undefined;

    try {
      const balanceBefore = await this.getExecutorBalance(acc.underlying);

      // make liquidatable using first strategy
      const ml = await this.#strategies[0].makeLiquidatable(acc);
      result.partialLiquidationCondition = ml.partialLiquidationCondition;

      for (const s of this.#strategies) {
        strategyResult = await this.#liquidateOneOptimisticStrategy(
          ml.account,
          s,
          ml.snapshotId,
        );
        if (strategyResult.success) {
          break;
        }
      }

      if (strategyResult) {
        result.assetOut = strategyResult.preview?.assetOut;
        result.amountOut = strategyResult.preview?.amountOut;
        result.flashLoanAmount = strategyResult.preview?.flashLoanAmount;
        result.calls = strategyResult.preview?.calls as MultiCall[];
        result.pathAmount = strategyResult.preview?.underlyingBalance ?? 0n;
        result.callsHuman = this.creditAccountService.sdk.parseMultiCall([
          ...(strategyResult.preview?.calls ?? []),
        ]);

        if (strategyResult.success) {
          result.balancesAfter = filterDustUSD({
            account: strategyResult.state,
            sdk: this.sdk,
          });
          result.hfAfter = strategyResult.state.healthFactor;
          result.liquidatorPremium =
            strategyResult.balancesAfter.underlying - balanceBefore.underlying;
          result.liquidatorProfit =
            strategyResult.balancesAfter.eth - balanceBefore.eth;
        }
        result.gasUsed = strategyResult.receipt?.gasUsed ?? 0n;
        result.isError = !strategyResult.success;

        if (strategyResult?.success === false) {
          const decoded = await this.errorHandler.explain(
            strategyResult.error,
            acc,
            true,
          );
          result.traceFile = decoded.traceFile;
          result.error = `cannot liquidate: ${decoded.longMessage}`.replaceAll(
            "\n",
            "\\n",
          );
          this.logger.error(`cannot liquidate: ${decoded.shortMessage}`);
        }
      } else {
        result.isError = true;
        result.error = "no applicable strategy found";
        this.logger.error("no applicable strategy found");
      }
    } catch (e) {
      result.isError = true;
      result.error = `${e}`;
      this.logger.error(e, "cannot liquidate");
    }

    result.duration = Date.now() - start;
    this.optimistic.push(result);

    return result;
  }

  async #liquidateOneOptimisticStrategy(
    acc: CreditAccountData,
    strategy: ILiquidationStrategy,
    snapshotId_: Hex | undefined,
  ): Promise<OptimisticStrategyResult> {
    let snapshotId = snapshotId_;
    const logger = this.logger.child({ strategy: strategy.name });
    let result: OptimisticStrategyResult = {
      success: true,
      state: acc,
      balancesAfter: { eth: 0n, underlying: 0n },
    };
    try {
      logger.debug({ snapshotId, strategy: strategy.name }, "previewing...");
      result.preview = await strategy.preview(acc);
      logger.debug("preview successful");

      const { request } = await strategy.simulate(acc, result.preview);
      logger.debug("simulate successful");

      // snapshotId might be present if we had to setup liquidation conditions for single account
      // otherwise, not write requests has been made up to this point, and it's safe to take snapshot now
      if (!snapshotId) {
        snapshotId = await this.client.anvil.snapshot();
      }
      // ------ Actual liquidation (write request start here) -----
      result.receipt = await this.client.liquidate(request);
      logger.debug(
        `Liquidation tx receipt: hash=${result.receipt.transactionHash}, status=${result.receipt.status}, gas=${result.receipt.cumulativeGasUsed.toString()}`,
      );
      if (result.receipt.status !== "success") {
        throw new TransactionRevertedError(result.receipt);
      }
      const ca = await this.creditAccountService.getCreditAccountData(
        acc.creditAccount,
      );
      if (!ca) {
        throw new Error(
          `account ${acc.creditAccount} not found after liquidation`,
        );
      }
      result.state = ca;
      // await this.swapper.swap(
      //   acc.underlying,
      //   balanceBefore.underlying + result.liquidatorPremium,
      // );
      result.balancesAfter = await this.getExecutorBalance(acc.underlying);
    } catch (e) {
      logger.error(e, "strategy failed");
      result = { ...result, success: false, error: e as Error };
    } finally {
      if (snapshotId) {
        await this.client.anvil.revert({ id: snapshotId });
      }
    }
    return result;
  }
}
