import type {
  CommonSchema,
  LiqduiatorConfig,
  PartialStrategySetup,
} from "@gearbox-protocol/liquidator-v2-config";
import { lowerHealthFactor } from "@gearbox-protocol/sdk/dev";
import {
  AddressMap,
  type CreditAccountData,
  type OnchainSDK,
  TypedObjectUtils,
} from "@gearbox-protocol/sdk/onchain";
import type { Address, Hex } from "viem";
import { DI } from "../../di.js";
import { type ILogger, Logger } from "../../log/index.js";
import type Client from "../Client.js";

/**
 * Result of {@link OptimisticLTs.lower}
 */
export interface LoweredLTs {
  /**
   * Re-read after lowering LTs
   */
  account: CreditAccountData;
  snapshotId: Hex;
  setup: PartialStrategySetup<bigint>;
}

interface PendingLTs {
  oldLTs: Record<Address, number>;
  newLTs: Record<Address, number>;
}

/**
 * For optimistic mode only: lowers liquidation thresholds of a credit account's
 * credit manager on anvil, so that the account becomes partially liquidatable.
 *
 * The sdk's cached credit manager state still holds the old LTs, so the new
 * ones are remembered per credit account until the strategy previews it.
 */
export class OptimisticLTs {
  @DI.Inject(DI.SDK)
  sdk!: OnchainSDK;

  @DI.Inject(DI.Config)
  config!: LiqduiatorConfig<CommonSchema>;

  @DI.Inject(DI.Client)
  client!: Client;

  @Logger("OptimisticLTs")
  logger!: ILogger;

  #pending = new AddressMap<PendingLTs>();

  /**
   * Snapshots and lowers LTs so that account's health factor becomes `hf`
   */
  public async lower(ca: CreditAccountData, hf: bigint): Promise<LoweredLTs> {
    if (!this.config.optimistic) {
      throw new Error("makeLiquidatable only works in optimistic mode");
    }
    this.#assertReserveFeeds(ca);
    const snapshotId = await this.client.anvil.snapshot();
    const { account, oldLTs, newLTs } = await lowerHealthFactor(
      this.client.anvil,
      this.sdk,
      ca,
      { hf, logger: this.logger },
    );
    this.#pending.upsert(ca.creditAccount, { oldLTs, newLTs });
    return {
      account,
      snapshotId,
      setup: {
        hfNew: account.healthFactor,
        ltChanges: Object.fromEntries(
          TypedObjectUtils.keys(newLTs).map(t => [
            t,
            [BigInt(oldLTs[t]), BigInt(newLTs[t])],
          ]),
        ),
      },
    };
  }

  /**
   * Writes LTs set by {@link lower} into the sdk's cached credit manager
   * state, for sdk methods that read LTs from it. Must be paired with
   * {@link revert}, because the cache is shared by all accounts of the credit manager.
   */
  public apply(ca: CreditAccountData): void {
    const pending = this.#pending.get(ca.creditAccount);
    if (pending) {
      this.#write(ca, pending.newLTs);
    }
  }

  /**
   * Restores cached LTs overwritten by {@link apply} and forgets LTs set by {@link lower}
   */
  public revert(ca: CreditAccountData): void {
    const pending = this.#pending.get(ca.creditAccount);
    if (pending) {
      this.#write(ca, pending.oldLTs);
      this.#pending.delete(ca.creditAccount);
    }
  }

  #write(ca: CreditAccountData, lts: Record<Address, number>): void {
    const { liquidationThresholds } = this.sdk.marketRegister.findCreditManager(
      ca.creditManager,
    ).creditManager;
    for (const t of TypedObjectUtils.keys(lts)) {
      liquidationThresholds.upsert(t, lts[t]);
    }
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
}
