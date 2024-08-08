import {
  batchLiquidatorAbi,
  iBatchLiquidatorAbi,
} from "@gearbox-protocol/liquidator-v2-contracts/abi";
import { BatchLiquidator_bytecode } from "@gearbox-protocol/liquidator-v2-contracts/bytecode";
import { iCreditFacadeV3Abi } from "@gearbox-protocol/types/abi";
import type { OptimisticResult } from "@gearbox-protocol/types/optimist";
import type { Address, TransactionReceipt } from "viem";
import { parseEventLogs } from "viem";

import type { CreditAccountData, CreditManagerData } from "../../data/index.js";
import type { EstimateBatchInput } from "../../utils/ethers-6-temp/pathfinder/viem-types.js";
import {
  BatchLiquidationErrorMessage,
  BatchLiquidationFinishedMessage,
} from "../notifier/messages.js";
import AbstractLiquidator from "./AbstractLiquidator.js";
import type { ILiquidatorService } from "./types.js";
import type {
  BatchLiquidationResult,
  LiquidateBatchInput,
} from "./viem-types.js";

interface BatchLiquidationOutput {
  readonly receipt: TransactionReceipt;
  readonly results: OptimisticResult[];
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
    this.logger.warn(`need to liquidate ${accounts.length} accounts`);
    const cms = await this.getCreditManagersV3List();
    const batches = this.#sliceBatches(accounts);

    for (const batch of batches) {
      this.logger.debug(
        `processing batch of ${batch.length} for ${batch[0]?.cmName}: ${batch.map(ca => ca.addr)}`,
      );
      try {
        const { receipt, results } = await this.#liquidateBatch(batch, cms);
        this.notifier.notify(
          new BatchLiquidationFinishedMessage(receipt, results),
        );
      } catch (e) {
        const decoded = await this.errorHandler.explain(e);
        this.logger.error(decoded, "cant liquidate");
        this.notifier.notify(
          new BatchLiquidationErrorMessage(batch, decoded.shortMessage),
        );
      }
    }
  }

  public async liquidateOptimistic(
    accounts: CreditAccountData[],
  ): Promise<void> {
    const cms = await this.getCreditManagersV3List();
    const total = accounts.length;
    this.logger.info(`optimistic batch-liquidation for ${total} accounts`);
    const batches = this.#sliceBatches(accounts);
    for (const batch of batches) {
      this.logger.debug(
        `processing batch of ${batch.length} for ${batch[0]?.cmName}: ${batch.map(ca => ca.addr)}`,
      );
      const { results } = await this.#liquidateBatch(batch, cms);
      for (const r of results) {
        this.optimistic.push(r);
      }
    }
    const success = this.optimistic.get().filter(r => !r.isError).length;
    this.logger.info(
      `optimistic batch-liquidation finished: ${success}/${total} accounts liquidated`,
    );
  }

  async #liquidateBatch(
    accounts: CreditAccountData[],
    cms: CreditManagerData[],
  ): Promise<BatchLiquidationOutput> {
    const inputs: EstimateBatchInput[] = [];
    for (const ca of accounts) {
      const cm = cms.find(m => ca.creditManager === m.address);
      if (!cm) {
        throw new Error(
          `cannot find credit manager data for ${ca.creditManager}`,
        );
      }
      inputs.push(
        this.pathFinder.getEstimateBatchInput(ca, cm, this.config.slippage),
      );
    }
    const { result } = await this.client.pub.simulateContract({
      account: this.client.account,
      address: this.batchLiquidator,
      abi: iBatchLiquidatorAbi,
      functionName: "estimateBatch",
      args: [inputs],
    });
    const batch: Record<Address, BatchLiquidationResult> = Object.fromEntries(
      result.map(r => [r.creditAccount.toLowerCase(), r]),
    );
    const liquidateBatchInput: LiquidateBatchInput[] = [];
    for (const r of result) {
      const input = inputs.find(
        i => i.creditAccount === r.creditAccount.toLowerCase(),
      );
      this.logger.debug(
        { executed: r.executed, pathFound: r.pathFound, input },
        `estimation for account ${r.creditAccount}`,
      );
      if (r.executed) {
        const acc = accounts.find(
          a => a.addr === r.creditAccount.toLowerCase(),
        );
        if (acc) {
          liquidateBatchInput.push({
            calls: r.calls,
            creditAccount: r.creditAccount,
            creditFacade: acc.creditFacade,
          });
        }
      }
    }
    this.logger.debug(
      {
        accounts: accounts.length,
        outputSize: result.length,
        executed: liquidateBatchInput.length,
      },
      "estimated batch",
    );

    const { request } = await this.client.pub.simulateContract({
      account: this.client.account,
      address: this.batchLiquidator,
      abi: iBatchLiquidatorAbi,
      functionName: "liquidateBatch",
      args: [liquidateBatchInput, this.client.address],
    });
    const receipt = await this.client.liquidate(request as any, this.logger); // TODO: types
    this.logger.debug(
      { tx: receipt.transactionHash, gasUsed: receipt.gasUsed },
      "liquidated batch",
    );

    const logs = parseEventLogs({
      abi: iCreditFacadeV3Abi,
      eventName: "LiquidateCreditAccount",
      logs: receipt.logs,
    });
    const liquidated = new Set(
      logs.map(l => l.args.creditAccount.toLowerCase() as Address),
    );
    this.logger.debug(`emitted ${liquidated.size} liquidation events`);
    const getError = (a: CreditAccountData): string | undefined => {
      if (liquidated.has(a.addr)) {
        return undefined;
      }
      const item = batch[a.addr];
      if (!item) {
        return "not found in estimateBatch output";
      }
      if (!item.pathFound) {
        return "batch path not found";
      }
      if (!item.executed) {
        return "cannot execute in estimateBatch";
      }
      return "cannot liquidate in batch";
    };
    const results = accounts.map(
      (a): OptimisticResult => ({
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

  #sliceBatches(accounts: CreditAccountData[]): CreditAccountData[][] {
    const batches: CreditAccountData[][] = [];
    const byCM: Record<string, CreditAccountData[]> = {};

    for (const account of accounts) {
      if (!byCM[account.creditManager]) {
        byCM[account.creditManager] = [];
      }
      byCM[account.creditManager].push(account);
    }

    // eslint-disable-next-line guard-for-in
    for (const cm in byCM) {
      const cmAccs = byCM[cm];
      for (let i = 0; i < cmAccs.length; i += this.config.batchSize) {
        batches.push(cmAccs.slice(i, i + this.config.batchSize));
      }
    }

    return batches;
  }
}
