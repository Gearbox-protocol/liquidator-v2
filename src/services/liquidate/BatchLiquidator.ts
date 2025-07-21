import {
  batchLiquidatorAbi,
  iBatchLiquidatorAbi,
} from "@gearbox-protocol/liquidator-v2-contracts/abi";
import { BatchLiquidator_bytecode } from "@gearbox-protocol/liquidator-v2-contracts/bytecode";
import {
  AP_ROUTER,
  type CreditAccountData,
  filterDust,
  type OnDemandPriceUpdate,
  VERSION_RANGE_300,
} from "@gearbox-protocol/sdk";
import {
  iCreditFacadeV3Abi,
  iCreditFacadeV3MulticallAbi,
} from "@gearbox-protocol/types/abi";
import type { OptimisticResult } from "@gearbox-protocol/types/optimist";
import type { Address, TransactionReceipt } from "viem";
import { encodeFunctionData, parseEventLogs } from "viem";
import type { BatchLiquidatorSchema } from "../../config/index.js";
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
  readonly results: OptimisticResult<bigint>[];
}

export default class BatchLiquidator
  extends AbstractLiquidator<BatchLiquidatorSchema>
  implements ILiquidatorService
{
  #batchLiquidator?: Address;

  public override async launch(asFallback?: boolean): Promise<void> {
    await super.launch(asFallback);
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
        this.logger.error(`cant liquidate: ${decoded.shortMessage}`);
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
      try {
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
      } catch (e) {
        const decoded = await this.errorHandler.explain(e);
        this.logger.error(decoded, "cant liquidate");
        for (const a of batch) {
          this.optimistic.push({
            ...this.newOptimisticResult(a),
            isError: true,
            error: `cannot liquidate: ${decoded.longMessage}`.replaceAll(
              "\n",
              "\\n",
            ),
            traceFile: decoded.traceFile,
          });
        }
      } finally {
        await this.client.anvil.revert({ id: snapshotId });
      }
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
      await this.#batchLiquidationPreviewUpdates(accounts);
    const inputs: EstimateBatchInput[] = [];
    for (const ca of accounts) {
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
      gas: 550_000_000n,
    });
    // BatchLiquidator contract does not return onDemandPriceUpdate calls, need to prepend them manually:
    for (let i = 0; i < accounts.length; i++) {
      const ca = accounts[i];
      const cm = this.sdk.marketRegister.findCreditManager(ca.creditManager);
      const updates = priceUpdatesByAccount[ca.creditAccount].map(
        ({ token, reserve, data }) => ({
          target: cm.creditFacade.address,
          callData: encodeFunctionData({
            abi: iCreditFacadeV3MulticallAbi,
            functionName: "onDemandPriceUpdate",
            args: [token, reserve, data],
          }),
        }),
      );
      result[i].calls = [...updates, ...result[i].calls];
    }

    const batch: Record<Address, BatchLiquidationResult> = Object.fromEntries(
      result.map(r => [r.creditAccount, r]),
    );
    const liquidateBatchInput: LiquidateBatchInput[] = [];
    for (const r of result) {
      const input = inputs.find(i => i.creditAccount === r.creditAccount);
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
        const acc = accounts.find(a => a.creditAccount === r.creditAccount);
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
    const liquidated = new Set(logs.map(l => l.args.creditAccount));
    this.logger.debug(`emitted ${liquidated.size} liquidation events`);
    const getError = (a: CreditAccountData): string | undefined => {
      if (liquidated.has(a.creditAccount)) {
        return undefined;
      }
      const item = batch[a.creditAccount];
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
      (a): OptimisticResult<bigint> => ({
        callsHuman: this.sdk.parseMultiCall([
          ...(batch[a.creditAccount]?.calls ?? []),
        ]),
        balancesBefore: filterDust(a),
        balancesAfter: {},
        hfBefore: a.healthFactor,
        hfAfter: 0n,
        creditManager: a.creditManager,
        borrower: a.owner,
        account: a.creditAccount,
        gasUsed: 0n, // cannot know for single account
        calls: [...(batch[a.creditAccount]?.calls ?? [])],
        pathAmount: 0n,
        liquidatorPremium: batch[a.creditAccount]?.profit ?? 0n,
        liquidatorProfit: 0n, // cannot compute for single account
        priceUpdates: priceUpdatesByAccount[a.creditAccount],
        isError: !liquidated.has(a.creditAccount),
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

      const hash = await this.client.wallet.deployContract({
        abi: batchLiquidatorAbi,
        bytecode: BatchLiquidator_bytecode,
        args: [this.#router],
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
    const router = this.sdk.routerFor(cm);
    const { pathOptions, connectors, expected, leftover } =
      router.getFindClosePathInput(ca, cm.creditManager);
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
    // Group accounts by oracle - so that price updates contain only tokens known to the oracle
    const accountsByOracle = new Map<Address, CreditAccountData[]>();
    for (const ca of accounts) {
      const market = this.sdk.marketRegister.findByCreditManager(
        ca.creditManager,
      );
      const oracle = market.priceOracle.address;
      if (!accountsByOracle.has(oracle)) {
        accountsByOracle.set(oracle, []);
      }
      accountsByOracle.get(oracle)?.push(ca);
    }

    // Sort accounts within each oracle by healthFactor bin ASC, debt DESC
    for (const oracleAccounts of accountsByOracle.values()) {
      oracleAccounts.sort((a, b) => {
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
    }

    // Create batches from each oracle's accounts
    const batches: CreditAccountData[][] = [];
    for (const oracleAccounts of accountsByOracle.values()) {
      for (let i = 0; i < oracleAccounts.length; i += this.config.batchSize) {
        batches.push(oracleAccounts.slice(i, i + this.config.batchSize));
      }
    }

    return batches;
  }

  /**
   * Gets updates from redstone for multiple accounts at once
   *
   * @param accounts
   * @returns
   */
  async #batchLiquidationPreviewUpdates(
    accounts: CreditAccountData[],
  ): Promise<Record<Address, OnDemandPriceUpdate[]>> {
    const tokensByAccount: Record<Address, Set<Address>> = {};
    for (const ca of accounts) {
      const accTokens = tokensByAccount[ca.creditAccount] ?? new Set<Address>();
      for (const { token, balance, mask } of ca.tokens) {
        const isEnabled = (mask & ca.enabledTokensMask) !== 0n;
        if (isEnabled && balance > 10n) {
          accTokens.add(token);
        }
      }
      tokensByAccount[ca.creditAccount] = accTokens;
    }
    const updates =
      await this.creditAccountService.getUpdateForAccounts(accounts);
    const result: Record<Address, OnDemandPriceUpdate[]> = {};
    for (const ca of accounts) {
      const market = this.sdk.marketRegister.findByCreditManager(
        ca.creditManager,
      );
      result[ca.creditAccount] =
        market.priceOracle.onDemandPriceUpdates(updates);
    }
    return result;
  }

  get #router(): Address {
    const router = this.sdk.addressProvider.getLatest(
      AP_ROUTER,
      VERSION_RANGE_300,
    );
    if (!router) {
      throw new Error("router v300 not found");
    }
    return router[0];
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
