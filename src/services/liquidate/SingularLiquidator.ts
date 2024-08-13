import type { OptimisticResult } from "@gearbox-protocol/types/optimist";
import type { Hex, SimulateContractReturnType } from "viem";

import type { CreditAccountData } from "../../data/index.js";
import { TxParserHelper } from "../../utils/ethers-6-temp/txparser/index.js";
import {
  LiquidationErrorMessage,
  LiquidationStartMessage,
  LiquidationSuccessMessage,
} from "../notifier/index.js";
import AbstractLiquidator from "./AbstractLiquidator.js";
import type {
  ILiquidatorService,
  MakeLiquidatableResult,
  StrategyPreview,
} from "./types.js";

export default abstract class SingularLiquidator<T extends StrategyPreview>
  extends AbstractLiquidator
  implements ILiquidatorService
{
  protected abstract readonly name: string;
  protected abstract readonly adverb: string;

  public async liquidate(accounts: CreditAccountData[]): Promise<void> {
    if (!accounts.length) {
      return;
    }
    this.logger.warn(`Need to liquidate ${accounts.length} accounts`);
    for (const ca of accounts) {
      await this.#liquidateOne(ca);
    }
  }

  public async liquidateOptimistic(
    accounts: CreditAccountData[],
  ): Promise<void> {
    const total = accounts.length;
    const debugS = this.config.debugAccounts ? "selective " : " ";
    this.logger.info(`${debugS}optimistic liquidation for ${total} accounts`);

    for (let i = 0; i < total; i++) {
      const acc = accounts[i];
      const result = await this.#liquidateOneOptimistic(acc);
      const status = result.isError ? "FAIL" : "OK";
      const msg = `[${i + 1}/${total}] ${acc.addr} in ${acc.creditManager} ${status}`;
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
    const logger = this.logger.child({
      account: ca.addr,
      borrower: ca.borrower,
      manager: ca.managerName,
    });
    if (this.skipList.has(ca.addr)) {
      this.logger.warn("skipping this account");
      return;
    }
    logger.info(`begin ${this.name} liquidation: HF = ${ca.healthFactor}`);
    this.notifier.notify(new LiquidationStartMessage(ca, this.name));
    let pathHuman: string[] | undefined;
    let preview: T | undefined;
    try {
      preview = await this.preview(ca);
      pathHuman = TxParserHelper.parseMultiCall(preview);
      logger.debug({ pathHuman }, "path found");

      const { request } = await this.simulate(ca, preview);
      const receipt = await this.client.liquidate(request, logger);

      this.notifier.alert(
        new LiquidationSuccessMessage(ca, this.adverb, receipt, pathHuman),
      );
    } catch (e) {
      const decoded = await this.errorHandler.explain(e, ca);
      logger.error(decoded, "cant liquidate");
      if (preview?.skipOnFailure) {
        this.skipList.add(ca.addr);
        this.logger.warn("adding to skip list");
      }
      this.notifier.alert(
        new LiquidationErrorMessage(
          ca,
          this.adverb,
          decoded.shortMessage,
          pathHuman,
          preview?.skipOnFailure,
        ),
      );
    }
  }

  async #liquidateOneOptimistic(
    acc: CreditAccountData,
  ): Promise<OptimisticResult> {
    const logger = this.logger.child({
      account: acc.addr,
      borrower: acc.borrower,
      manager: acc.managerName,
    });
    let snapshotId: Hex | undefined;
    let result = this.newOptimisticResult(acc);
    const start = Date.now();
    try {
      const balanceBefore = await this.getExecutorBalance(acc.underlyingToken);
      const mlRes = await this.makeLiquidatable(acc);
      snapshotId = mlRes.snapshotId;
      result.partialLiquidationCondition = mlRes.partialLiquidationCondition;
      logger.debug({ snapshotId }, "previewing...");
      const preview = await this.preview(acc);
      logger.debug({ pathHuman: result.callsHuman }, "path found");
      result = this.updateAfterPreview(result, preview);

      const { request } = await this.simulate(acc, preview);

      // snapshotId might be present if we had to setup liquidation conditions for single account
      // otherwise, not write requests has been made up to this point, and it's safe to take snapshot now
      if (!snapshotId) {
        snapshotId = await this.client.anvil.snapshot();
      }
      // ------ Actual liquidation (write request start here) -----
      const receipt = await this.client.liquidate(request, logger);
      logger.debug(`Liquidation tx hash: ${receipt.transactionHash}`);
      result.isError = receipt.status === "reverted";
      logger.debug(
        `Liquidation tx receipt: status=${receipt.status}, gas=${receipt.cumulativeGasUsed.toString()}`,
      );
      // ------ End of actual liquidation
      result = await this.updateAfterLiquidation(
        result,
        acc,
        balanceBefore.underlying,
        receipt,
      );
      // swap underlying back to ETH
      await this.swapper.swap(
        acc.underlyingToken,
        balanceBefore.underlying + BigInt(result.liquidatorPremium),
      );
      const balanceAfter = await this.getExecutorBalance(acc.underlyingToken);
      result.liquidatorProfit = (balanceAfter.eth - balanceBefore.eth).toString(
        10,
      );
    } catch (e: any) {
      const decoded = await this.errorHandler.explain(e, acc, true);
      result.traceFile = decoded.traceFile;
      result.error = `cannot liquidate: ${decoded.longMessage}`.replaceAll(
        "\n",
        "\\n",
      );
      logger.error({ decoded }, "cannot liquidate");
    }

    result.duration = Date.now() - start;
    this.optimistic.push(result);

    if (snapshotId) {
      await this.client.anvil.revert({ id: snapshotId });
    }

    return result;
  }

  /**
   * For optimistic liquidations only: create conditions that make this account liquidatable
   * If strategy implements this scenario, it must make evm_snapshot beforehand and return it as a result
   * Id strategy does not support this, return undefined
   * @param ca
   * @returns evm snapshotId or underfined
   */
  abstract makeLiquidatable(
    ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult>;
  abstract preview(ca: CreditAccountData): Promise<T>;
  /**
   * Simulates liquidation
   * @param account
   * @param preview
   * @returns
   */
  abstract simulate(
    account: CreditAccountData,
    preview: T,
  ): Promise<SimulateContractReturnType>;
}
