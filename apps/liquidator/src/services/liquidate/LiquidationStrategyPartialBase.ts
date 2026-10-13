import type {
  CommonSchema,
  LiqduiatorConfig,
  PartialStrategyPreview,
  PartialStrategySetup,
} from "@gearbox-protocol/liquidator-v2-config";
import { iPhantomTokenAbi } from "@gearbox-protocol/sdk/abi/iPhantomToken";
import { calcLiquidatableLTs, setLTs } from "@gearbox-protocol/sdk/dev";
import {
  AddressMap,
  AddressSet,
  type CreditAccountData,
  type OnchainSDK,
} from "@gearbox-protocol/sdk/onchain";
import pLimit from "p-limit";
import type { Address, Hex } from "viem";
import { DI } from "../../di.js";
import { type ILogger, Logger } from "../../log/index.js";
import type Client from "../Client.js";
import AccountHelper from "./AccountHelper.js";
import {
  type ConversionWarmUpTask,
  humanizeOptimalLiquidation,
  type IPartialLiquidatorContract,
  PartialContractsDeployer,
} from "./partial/index.js";
import type {
  ILiquidationStrategy,
  LiquidationRequest,
  MakeLiquidatableResult,
} from "./types.js";

interface LiquidatorWarmUpTask {
  liquidator: IPartialLiquidatorContract;
  task: ConversionWarmUpTask;
}

interface ConversionWarmUpReport {
  accounts: number;
  tasks: number;
  ok: number;
  /**
   * Still useful: slots loaded before revert stay in fork cache
   */
  reverted: number;
  /**
   * Not started because warm-up timeout was reached
   */
  skipped: number;
  durationMs: number;
}

/**
 * Shared logic for partial and deleverage strategies, generic over the kind so
 * that `makeLiquidatable` and `preview` stay aligned. Concrete leaves provide
 * `kind`, `name` and `makeLiquidatable`.
 */
export default abstract class LiquidationStrategyPartialBase<
    K extends "partial" | "deleverage",
  >
  extends AccountHelper
  implements ILiquidationStrategy<K>
{
  @DI.Inject(DI.SDK)
  sdk!: OnchainSDK;

  @DI.Inject(DI.Config)
  config!: LiqduiatorConfig<CommonSchema>;

  @DI.Inject(DI.Client)
  client!: Client;

  @Logger("PartialStrategy")
  logger!: ILogger;

  public abstract readonly kind: K;

  public abstract get name(): string;

  public get premiumReceiver(): Address {
    return this.client.address;
  }

  #deployer: PartialContractsDeployer;
  /**
   * LTs lowered by makePartialLiquidatable, keyed by credit account, consumed by preview.
   * The sdk's cached credit manager state still holds the old LTs.
   * For Optimistic mode only.
   */
  #ltOverrides = new AddressMap<AddressMap<number>>();

  constructor() {
    super();
    this.#deployer = new PartialContractsDeployer(this.sdk);
  }

  public async launch(): Promise<void> {
    await this.#deployer.syncState();
  }

  public async syncState(_blockNumber: bigint): Promise<void> {
    await this.#deployer.syncState();
  }

  public isApplicable(_ca: CreditAccountData, _optimistic: boolean): boolean {
    return true;
  }

  /**
   * Routes seized collateral of every account to underlying, so that router and pool storage
   * is loaded before makePartialLiquidatable takes its snapshot.
   * One route per (credit manager, token) pair with the largest amount: graph depends only on credit manager,
   * and a larger swap crosses a superset of ticks
   */
  public async warmUp(accounts: CreditAccountData[]): Promise<void> {
    const start = Date.now();
    const candidates = await this.#warmUpCandidates(accounts);
    const tasks = await this.#mapPhantomTokens(candidates);
    const report: ConversionWarmUpReport = {
      accounts: accounts.length,
      tasks: tasks.length,
      ok: 0,
      reverted: 0,
      skipped: 0,
      durationMs: 0,
    };
    const limit = pLimit(8);
    await Promise.all(
      tasks.map(({ liquidator, task }) =>
        limit(async () => {
          try {
            await liquidator.warmUpConversion(task);
            report.ok++;
          } catch (e) {
            report.reverted++;
            this.logger.debug(
              `warm-up of ${task.tokenIn} in ${task.creditManager} reverted: ${e}`,
            );
          }
        }),
      ),
    );
    report.durationMs = Date.now() - start;
    this.logger.info(report, "conversion warm-up finished");
  }

  async #warmUpCandidates(
    accounts: CreditAccountData[],
  ): Promise<LiquidatorWarmUpTask[]> {
    const result = new Map<string, LiquidatorWarmUpTask>();
    for (const ca of accounts) {
      try {
        const liquidator = this.#liquidatorForCA(ca);
        if (!liquidator || ca.debt === 0n) {
          continue;
        }
        const lts = await calcLiquidatableLTs(
          this.sdk,
          ca,
          this.optimisticHF(ca),
        );
        const optimal = liquidator.getOptimalLiquidation(
          ca,
          AddressMap.fromRecord(lts),
        );
        if (optimal.optimalAmount === 0n) {
          continue;
        }
        const market = this.sdk.marketRegister.findByCreditManager(
          ca.creditManager,
        );
        const amountIn = market.priceOracle.convert(
          ca.underlying,
          optimal.tokenOut,
          optimal.optimalAmount,
        );
        const key = `${ca.creditManager}:${optimal.tokenOut}`.toLowerCase();
        const prev = result.get(key);
        if (!prev || prev.task.amountIn < amountIn) {
          result.set(key, {
            liquidator,
            task: {
              creditManager: ca.creditManager,
              tokenIn: optimal.tokenOut,
              amountIn,
              underlying: ca.underlying,
            },
          });
        }
      } catch {
        // main pass reports such accounts
      }
    }
    return Array.from(result.values());
  }

  /**
   * Router converts phantom token's deposited token, same as previewPartialLiquidation does
   */
  async #mapPhantomTokens(
    tasks: LiquidatorWarmUpTask[],
  ): Promise<LiquidatorWarmUpTask[]> {
    const phantoms = new AddressSet();
    for (const { task } of tasks) {
      const meta = this.sdk.tokensMeta.get(task.tokenIn);
      try {
        if (meta && this.sdk.tokensMeta.isPhantomToken(meta)) {
          phantoms.add(task.tokenIn);
        }
      } catch {}
    }
    if (phantoms.size === 0) {
      return tasks;
    }
    const tokens = Array.from(phantoms);
    const infos = await this.client.pub.multicall({
      allowFailure: true,
      contracts: tokens.map(
        address =>
          ({
            address,
            abi: iPhantomTokenAbi,
            functionName: "getPhantomTokenInfo",
          }) as const,
      ),
    });
    const deposited = new AddressMap<Address>();
    for (let i = 0; i < tokens.length; i++) {
      const info = infos[i];
      if (info.status === "success") {
        deposited.upsert(tokens[i], info.result[1]);
      }
    }
    return tasks.map(t => {
      const tokenIn = deposited.get(t.task.tokenIn);
      return tokenIn ? { ...t, task: { ...t.task, tokenIn } } : t;
    });
  }

  public abstract makeLiquidatable(
    ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult<K>>;

  /**
   * Lowers liquidation thresholds (and snapshots) to make the account partially
   * liquidatable. Shared core used by both partial and deleverage.
   */
  protected async makePartialLiquidatable(ca: CreditAccountData): Promise<{
    account: CreditAccountData;
    snapshotId: Hex;
    setup: PartialStrategySetup<bigint>;
  }> {
    if (!this.config.optimistic) {
      throw new Error("makeLiquidatable only works in optimistic mode");
    }
    if (ca.debt === 0n) {
      throw new Error("warning: zero-debt account");
    }
    this.#assertReserveFeeds(ca);
    if (!this.#liquidatorForCA(ca)) {
      throw new Error(
        "warning: account's credit manager is not registered in partial liquidator",
      );
    }
    const cm = this.sdk.marketRegister.findCreditManager(ca.creditManager);
    const newLTs = await calcLiquidatableLTs(
      this.sdk,
      ca,
      this.optimisticHF(ca),
      this.logger,
    );
    const snapshotId = await this.client.anvil.snapshot();

    await setLTs(this.client.anvil, cm.state, newLTs, this.logger);
    this.#ltOverrides.upsert(ca.creditAccount, AddressMap.fromRecord(newLTs));
    const account = await this.sdk.accounts.getCreditAccountData(
      ca.creditAccount,
    );
    if (!account) {
      throw new Error(`cannot find credit account ${ca.creditAccount}`);
    }
    this.logger.debug({
      hfNew: account.healthFactor.toString(),
      hfOld: ca.healthFactor.toString(),
    });
    return {
      account,
      snapshotId,
      setup: {
        hfNew: account.healthFactor,
        ltChanges: Object.fromEntries(
          Object.entries(newLTs).map(([t, newLT]) => [
            t,
            [
              BigInt(
                cm.creditManager.liquidationThresholds.mustGet(t as Address),
              ),
              BigInt(newLT),
            ],
          ]),
        ),
      },
    };
  }

  public async preview(
    ca: CreditAccountData,
  ): Promise<PartialStrategyPreview<bigint>> {
    const cm = this.sdk.marketRegister.findCreditManager(ca.creditManager);
    const priceUpdates = await this.sdk.accounts.getOnDemandPriceUpdates(
      ca,
      this.ignoreReservePrices(ca),
    );
    const liquidatorContract = this.#liquidatorForCA(ca);
    if (!liquidatorContract) {
      throw new Error(
        `no partial liquidator contract found for account ${ca.creditAccount} in ${cm.name}`,
      );
    }
    const ltOverrides = this.#ltOverrides.get(ca.creditAccount);
    this.#ltOverrides.delete(ca.creditAccount);
    const optimalLiquidation = liquidatorContract.getOptimalLiquidation(
      ca,
      ltOverrides,
    );
    this.logger.debug(
      humanizeOptimalLiquidation(cm, optimalLiquidation),
      "found optimal liquidation",
    );
    if (optimalLiquidation.optimalAmount === 0n) {
      throw new Error(
        "warning: optimal liquidation amount is zero, account is either healthy enough or its debt is below min debt",
      );
    }

    try {
      const preview = await liquidatorContract.previewPartialLiquidation(
        ca,
        cm,
        optimalLiquidation,
        priceUpdates,
      );
      if (preview.profit < 0n) {
        if (optimalLiquidation.isOptimalRepayable) {
          throw new Error("optimal liquidation is not profitable or errored");
        } else {
          throw new Error(
            "warning: cannot liquidate while remaining within borrowing limits",
          );
        }
      }
      return {
        assetOut: optimalLiquidation.tokenOut,
        amountOut: optimalLiquidation.optimalAmount,
        flashLoanAmount: optimalLiquidation.flashLoanAmount,
        priceUpdates,
        calls: preview.calls.map(c => ({
          callData: c.callData,
          target: c.target,
        })),
        previewedProfit: preview.profit,
        skipOnFailure: !optimalLiquidation.isOptimalRepayable,
      };
    } catch (e) {
      if (!optimalLiquidation.isOptimalRepayable) {
        throw new Error(`warning: ${e}`);
      }
      throw e;
    }
  }

  public async simulate(
    account: CreditAccountData,
    preview: PartialStrategyPreview<bigint>,
  ): Promise<LiquidationRequest> {
    const liquidator = this.#liquidatorForCA(account);
    if (!liquidator) {
      throw new Error(
        `no partial liquidator contract found for account ${account.creditAccount} in ${account.creditManager}`,
      );
    }
    return liquidator.partialLiquidateAndConvert(account, preview);
  }

  /**
   * Depending on credit manager underlying token, different partial liquidator contract should be used
   * @param ca
   * @returns
   */
  #liquidatorForCA(
    ca: CreditAccountData,
  ): IPartialLiquidatorContract | undefined {
    return this.#deployer.getLiquidatorForCM(ca.creditManager);
  }

  /**
   * Throws if account has non-dust tokens without reserve price feeds
   * @param ca
   */
  #assertReserveFeeds(ca: CreditAccountData): void {
    const market = this.sdk.marketRegister.findByCreditManager(
      ca.creditManager,
    );
    const feeds = market.priceOracle.reservePriceFeeds;
    for (const { token, balance } of ca.tokens) {
      if (token === ca.underlying) {
        continue;
      }
      if (balance > 10n && !feeds.has(token)) {
        throw new Error(
          "warning: account has tokens without reserve price feeds",
        );
      }
    }
  }

  protected ignoreReservePrices(_ca: CreditAccountData): boolean {
    return !this.config.updateReservePrices;
  }

  protected optimisticHF(_ca: CreditAccountData): bigint {
    return 9990n;
  }
}
