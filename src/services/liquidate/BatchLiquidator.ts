import {
  batchLiquidatorAbi,
  iBatchLiquidatorAbi,
} from "@gearbox-protocol/liquidator-v2-contracts/abi";
import { BatchLiquidator_bytecode } from "@gearbox-protocol/liquidator-v2-contracts/bytecode";
import type { CreditAccountData } from "@gearbox-protocol/sdk";
import { iCreditFacadeV3Abi } from "@gearbox-protocol/types/abi";
import type { OptimisticResult } from "@gearbox-protocol/types/optimist";
import type { Address, TransactionReceipt } from "viem";
import { parseEventLogs } from "viem";

import {
  BatchLiquidationErrorMessage,
  BatchLiquidationFinishedMessage,
} from "../notifier/messages.js";
import AbstractLiquidator from "./AbstractLiquidator.js";
import type { ILiquidatorService } from "./types.js";
import type {
  BatchLiquidationResult,
  EstimateBatchInput,
  LiquidateBatchInput,
} from "./viem-types.js";

const MAX_GAS_PER_ROUTE = 200_000_000n;
const GAS_PER_BLOCK = 400_000_000n;
const LOOPS_PER_TX = Number(GAS_PER_BLOCK / MAX_GAS_PER_ROUTE);

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
    const batches = this.#sliceBatches(accounts);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      this.logger.debug(
        `processing batch of ${batch.length} for ${batch[0]?.creditManager}: ${batch.map(ca => ca.creditAccount)}`,
      );
      try {
        const { receipt, results } = await this.#liquidateBatch(
          batch,
          i,
          batches.length,
        );
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
    const total = accounts.length;
    this.logger.info(`optimistic batch-liquidation for ${total} accounts`);
    const batches = this.#sliceBatches(accounts);
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      this.logger.debug(
        `processing batch of ${batch.length} for ${batch[0]?.creditManager}: ${batch.map(ca => ca.creditAccount)}`,
      );
      const snapshotId = await this.client.anvil.snapshot();
      const { results, receipt } = await this.#liquidateBatch(
        batch,
        i,
        batches.length,
      );
      const hasErrors = results.some(r => !!r.isError);
      let traceId: string | undefined;
      if (hasErrors && !!receipt) {
        traceId = await this.errorHandler.saveTransactionTrace(
          receipt.transactionHash,
        );
      }
      for (const r of results) {
        this.optimistic.push({ ...r, traceFile: traceId });
      }
      await this.client.anvil.revert({ id: snapshotId });
    }
    const success = this.optimistic.get().filter(r => !r.isError).length;
    this.logger.info(
      `optimistic batch-liquidation finished: ${success}/${total} accounts liquidated`,
    );
  }

  async #liquidateBatch(
    accounts: CreditAccountData[],
    index: number,
    total: number,
  ): Promise<BatchLiquidationOutput> {
    const priceUpdatesByAccount =
      await this.redstone.batchLiquidationPreviewUpdates(accounts);
    const inputs: EstimateBatchInput[] = [];
    for (const ca of accounts) {
      const cm = cms.find(m => ca.creditManager === m.address);
      if (!cm) {
        throw new Error(
          `cannot find credit manager data for ${ca.creditManager}`,
        );
      }
      // pathfinder returns input without price updates
      const input = this.#getEstimateBatchInput(ca);
      input.priceUpdates = priceUpdatesByAccount[ca.creditAccount];
      inputs.push(input);
    }
    const { result } = await this.client.pub.simulateContract({
      account: this.client.account,
      address: this.batchLiquidator,
      abi: iBatchLiquidatorAbi,
      functionName: "estimateBatch",
      args: [inputs],
    });
    // BatchLiquidator contract does not return onDemandPriceUpdate calls, need to prepend them manually:
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      result[i].calls = [
        ...this.redstone.toMulticallUpdates(
          account,
          priceUpdatesByAccount[account.addr],
        ),
        ...result[i].calls,
      ];
    }

    const batch: Record<Address, BatchLiquidationResult> = Object.fromEntries(
      result.map(r => [r.creditAccount.toLowerCase(), r]),
    );
    const liquidateBatchInput: LiquidateBatchInput[] = [];
    for (const r of result) {
      const input = inputs.find(
        i => i.creditAccount === r.creditAccount.toLowerCase(),
      );
      this.logger.debug(
        {
          account: r.creditAccount,
          executed: r.executed,
          pathFound: r.pathFound,
          calls: r.calls,
          input,
        },
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
        callsHuman: TxParserHelper.parseMultiCall({
          calls: [...(batch[a.addr]?.calls ?? [])],
        }),
        balancesBefore: a.filterDust(),
        balancesAfter: {},
        hfBefore: Number(a.healthFactor),
        hfAfter: 0,
        creditManager: a.creditManager,
        borrower: a.borrower,
        account: a.addr,
        gasUsed: 0, // cannot know for single account
        calls: [...(batch[a.addr]?.calls ?? [])],
        pathAmount: "0", // TODO: ??
        liquidatorPremium: (batch[a.addr]?.profit ?? 0n).toString(10),
        liquidatorProfit: "0", // cannot compute for single account
        priceUpdates: priceUpdatesByAccount[a.addr],
        isError: !liquidated.has(a.addr),
        error: getError(a),
        batchId: `${index + 1}/${total}`,
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

  #getEstimateBatchInput(ca: CreditAccountData): EstimateBatchInput {
    const cm = this.sdk.marketRegister.findCreditManager(ca.creditManager);
    const { pathOptions, connectors, expected, leftover } =
      this.sdk.router.getFindClosePathInput(ca, cm.creditManager);
    return {
      creditAccount: ca.creditAccount,
      expectedBalances: expected,
      leftoverBalances: leftover,
      connectors,
      slippage: BigInt(this.config.slippage),
      pathOptions: pathOptions[0] ?? [], // TODO: what to put here?
      iterations: BigInt(LOOPS_PER_TX),
      force: false,
      priceUpdates: [],
    };
  }

  #sliceBatches(accounts: CreditAccountData[]): CreditAccountData[][] {
    // sort by healthFactor bin ASC, debt DESC
    const sortedAccounts = accounts.sort((a, b) => {
      if (a.healthFactor !== b.healthFactor) {
        return healthFactorBin(a) - healthFactorBin(b);
      }
      if (b.totalDebtUSD > a.totalDebtUSD) {
        return 1;
      } else if (b.totalDebtUSD === a.totalDebtUSD) {
        return 0;
      } else {
        return -1;
      }
    });

    const batches: CreditAccountData[][] = [];
    for (let i = 0; i < sortedAccounts.length; i += this.config.batchSize) {
      batches.push(sortedAccounts.slice(i, i + this.config.batchSize));
    }
    return batches;
  }
}

function healthFactorBin({ healthFactor }: CreditAccountData): number {
  if (healthFactor < 9300) {
    return 0;
  } else if (healthFactor < 9600) {
    return 1;
  } else {
    return 2;
  }
}
