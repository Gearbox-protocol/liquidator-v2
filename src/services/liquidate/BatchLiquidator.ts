import {
  batchLiquidatorAbi,
  iBatchLiquidatorAbi,
} from "@gearbox-protocol/liquidator-v2-contracts/abi";
import { BatchLiquidator_bytecode } from "@gearbox-protocol/liquidator-v2-contracts/bytecode";
import { iCreditFacadeV3Abi } from "@gearbox-protocol/types/abi";
import type { OptimisticResultV2 } from "@gearbox-protocol/types/optimist";
import type { Address, TransactionReceipt } from "viem";
import { parseEventLogs } from "viem";

import type { CreditAccountData } from "../../data/index.js";
import {
  BatchLiquidationErrorMessage,
  BatchLiquidationFinishedMessage,
} from "../notifier/messages.js";
import AbstractLiquidator from "./AbstractLiquidator.js";
import type { ILiquidatorService } from "./types.js";
import type { BatchLiquidationResult } from "./viem-types.js";

interface BatchLiquidationOutput {
  readonly receipt: TransactionReceipt;
  readonly results: OptimisticResultV2[];
}

export default class BatchLiquidator
  extends AbstractLiquidator
  implements ILiquidatorService
{
  #batchLiquidator?: Address;

  public override async launch(): Promise<void> {
    await super.launch();
    await this.#deployContract();
  }

  public async liquidate(accounts: CreditAccountData[]): Promise<void> {
    if (!accounts.length) {
      return;
    }
    this.logger.warn(`Need to liquidate ${accounts.length} accounts`);
    try {
      const { receipt, results } = await this.#liquidateBatch(accounts);
      this.notifier.notify(
        new BatchLiquidationFinishedMessage(receipt, results),
      );
    } catch (e) {
      const decoded = await this.errorHandler.explain(e);
      this.logger.error(decoded, "cant liquidate");
      this.notifier.notify(
        new BatchLiquidationErrorMessage(accounts, decoded.shortMessage),
      );
    }
  }

  public async liquidateOptimistic(
    accounts: CreditAccountData[],
  ): Promise<void> {
    const total = accounts.length;
    this.logger.info(`optimistic batch-liquidation for ${total} accounts`);
    const { results } = await this.#liquidateBatch(accounts);
    const success = results.filter(r => !r.isError).length;
    for (const r of results) {
      this.optimistic.push(r);
    }
    this.logger.info(
      `optimistic batch-liquidation finished: ${success}/${total} accounts liquidated`,
    );
  }

  async #liquidateBatch(
    accounts: CreditAccountData[],
  ): Promise<BatchLiquidationOutput> {
    const input = accounts.map(ca =>
      this.pathFinder.getEstimateBatchInput(ca, this.config.slippage),
    );
    const { result } = await this.client.pub.simulateContract({
      account: this.client.account,
      address: this.batchLiquidator,
      abi: iBatchLiquidatorAbi,
      functionName: "estimateBatch",
      args: [input] as any, // TODO: types
    });
    const batch: Record<Address, BatchLiquidationResult> = Object.fromEntries(
      result.map(r => [r.creditAccount.toLowerCase(), r]),
    );
    this.logger.debug(result, "estimated batch");

    const { request } = await this.client.pub.simulateContract({
      account: this.client.account,
      address: this.batchLiquidator,
      abi: iBatchLiquidatorAbi,
      functionName: "liquidateBatch",
      args: [
        result
          .filter(i => i.executed)
          .map(i => ({
            calls: i.calls,
            creditAccount: i.creditAccount,
            creditFacade: accounts.find(
              ca => ca.addr === i.creditAccount.toLowerCase(),
            )?.creditFacade!, // TODO: checks
          })),
        this.client.address,
      ],
    });
    const receipt = await this.client.liquidate(request as any, this.logger); // TODO: types

    const logs = parseEventLogs({
      abi: iCreditFacadeV3Abi,
      eventName: "LiquidateCreditAccount",
      logs: receipt.logs,
    });
    const liquidated = new Set(
      logs.map(l => l.args.creditAccount.toLowerCase() as Address),
    );
    const getError = (a: CreditAccountData): string | undefined => {
      if (liquidated.has(a.addr)) {
        return undefined;
      }
      const item = batch[a.addr];
      if (!item) {
        return "not found in estimateBatch output";
      }
      if (item.pathFound) {
        return "batch path not found";
      }
      if (item.executed) {
        return "cannot execute in estimateBatch";
      }
      return "cannot liquidate in batch";
    };
    const results = accounts.map(
      (a): OptimisticResultV2 => ({
        version: "2",
        callsHuman: [],
        balancesBefore: a.filterDust(),
        balancesAfter: {},
        hfBefore: a.healthFactor,
        hfAfter: 0,
        creditManager: a.creditManager,
        borrower: a.borrower,
        account: a.addr,
        gasUsed: 0, // cannot know for single account
        calls: [...(batch[a.addr]?.calls ?? [])],
        pathAmount: "0", // TODO: ??
        liquidatorPremium: (batch[a.addr]?.profit ?? 0n).toString(10),
        liquidatorProfit: "0", // cannot compute for single account
        isError: !liquidated.has(a.addr),
        error: getError(a),
      }),
    );
    return {
      receipt,
      results,
    };
  }

  async #deployContract(): Promise<void> {
    this.#batchLiquidator = this.config.batchLiquidatorAddress;
    if (!this.#batchLiquidator) {
      this.logger.debug("deploying batch liquidator");

      let hash = await this.client.wallet.deployContract({
        abi: batchLiquidatorAbi,
        bytecode: BatchLiquidator_bytecode,
        args: [this.router],
      });
      this.logger.debug(
        `waiting for BatchLiquidator to deploy, tx hash: ${hash}`,
      );
      const { contractAddress } =
        await this.client.pub.waitForTransactionReceipt({
          hash,
          timeout: 120_000,
        });
      if (!contractAddress) {
        throw new Error(`BatchLiquidator was not deployed, tx hash: ${hash}`);
      }
      this.#batchLiquidator = contractAddress;
    }
    this.logger.debug(
      `using batch liquidator contract ${this.#batchLiquidator}`,
    );
  }

  private get batchLiquidator(): Address {
    if (!this.#batchLiquidator) {
      throw new Error("batch liquidator not deployed");
    }
    return this.#batchLiquidator;
  }
}
