import type {
  IPriceOracleV3,
  NetworkType,
  RedstonePriceFeed,
} from "@gearbox-protocol/sdk";
import {
  IPriceOracleV3__factory,
  RedstonePriceFeed__factory,
} from "@gearbox-protocol/sdk";
import type {
  SetPriceFeedEvent,
  SetReservePriceFeedEvent,
  SetReservePriceFeedStatusEvent,
} from "@gearbox-protocol/sdk/lib/types/IPriceOracleV3.sol/IPriceOracleV3";
import type { providers } from "ethers";
import { utils } from "ethers";
import { Inject, Service } from "typedi";

import { Logger, LoggerInterface } from "../log";
import { AddressProviderService } from "./AddressProviderService";
import type { MCall } from "./utils";
import { safeMulticall } from "./utils";

const RedstoneInterface = RedstonePriceFeed__factory.createInterface();

interface PriceFeedEntry {
  address: string;
  /**
   * Is set for redstone feeds, null for non-redstone feeds, undefined if unknown
   */
  dataFeedId?: string | null;
}

interface OracleEntry {
  main: PriceFeedEntry;
  reserve?: PriceFeedEntry;
  active: "main" | "reserve";
}

const ORACLE_START_BLOCK: Record<NetworkType, number> = {
  Mainnet: 18797638,
  Optimism: 116864678, // not deployed yet, arbitrary block here
  Arbitrum: 184650373,
  Base: 12299805, // not deployed yet, arbitrary block here
};

@Service()
export default class OracleServiceV3 {
  @Logger("ScanServiceV3")
  log: LoggerInterface;

  @Inject()
  addressProvider: AddressProviderService;

  #oracle?: IPriceOracleV3;
  #provider?: providers.Provider;
  #lastBlock = 0;

  #feeds: Record<string, OracleEntry> = {};

  public async launch(
    provider: providers.Provider,
    block: number,
  ): Promise<void> {
    this.#lastBlock = ORACLE_START_BLOCK[this.addressProvider.network];
    this.#provider = provider;
    const oracle = await this.addressProvider.findService("PRICE_ORACLE", 300);
    this.#oracle = IPriceOracleV3__factory.connect(oracle, provider);
    this.log.debug(`starting oracle v3 at ${block}`);
    await this.#updateFeeds(block);
    this.log.info(`started with ${Object.keys(this.#feeds).length} tokens`);
  }

  public async update(blockNumber: number): Promise<void> {
    await this.#updateFeeds(blockNumber);
  }

  /**
   * Checks if token is present in price oracle
   * @param token
   * @returns
   */
  public hasFeed(token: string): boolean {
    return !!this.#feeds[token.toLowerCase()];
  }

  /**
   * Returns mapping of currently active redstone feeds
   * Keys are lowercased token addresses
   * Values are redstone dataFeedIds
   */
  public getRedstoneFeeds(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [token, entry] of Object.entries(this.#feeds)) {
      const feed = entry[entry.active];
      if (feed?.dataFeedId) {
        result[token.toLowerCase()] = feed.dataFeedId;
      }
    }
    return result;
  }

  async #updateFeeds(toBlock: number): Promise<void> {
    if (toBlock <= this.#lastBlock) {
      return;
    }
    this.log.debug(`updating price feeds in [${this.#lastBlock}, ${toBlock}]`);
    const events = await this.oracle.queryFilter<
      | SetPriceFeedEvent
      | SetReservePriceFeedEvent
      | SetReservePriceFeedStatusEvent
    >({}, this.#lastBlock, toBlock);
    this.log.debug(`found ${events.length} oracle events`);
    for (const e of events) {
      switch (e.event) {
        case "SetPriceFeed":
          await this.#setPriceFeed(e as SetPriceFeedEvent);
          break;
        case "SetReservePriceFeed":
          await this.#setPriceFeed(e as SetReservePriceFeedEvent);
          break;
        case "SetReservePriceFeedStatus":
          this.#setFeedStatus(e as SetReservePriceFeedStatusEvent);
          break;
      }
    }
    await this.#loadRedstoneIds();
    this.#lastBlock = toBlock;
  }

  async #setPriceFeed(
    e: SetPriceFeedEvent | SetReservePriceFeedEvent,
  ): Promise<void> {
    const kind = e.event === "SetPriceFeed" ? "main" : "reserve";
    const token = e.args.token.toLowerCase();
    const priceFeed = e.args.priceFeed.toLowerCase();
    let entry = this.#feeds[token];
    if (!entry) {
      if (kind === "reserve") {
        throw new Error(
          `cannot add reserve price feed ${priceFeed} for token ${token} because main price feed is not added yet`,
        );
      }
      entry = { active: "main", main: { address: priceFeed } };
    }
    entry[kind] = { address: priceFeed };
    this.#feeds[token] = entry;
  }

  async #loadRedstoneIds(): Promise<void> {
    const calls: MCall<RedstonePriceFeed["interface"]>[] = [];
    for (const f of Object.values(this.#feeds)) {
      if (f.main.dataFeedId === undefined) {
        calls.push({
          address: f.main.address,
          interface: RedstoneInterface,
          method: "dataFeedId()",
        });
      }
      if (!!f.reserve && f.reserve.dataFeedId === undefined) {
        calls.push({
          address: f.reserve.address,
          interface: RedstoneInterface,
          method: "dataFeedId()",
        });
      }
    }
    this.log.debug(`need to get redstone data ids on ${calls.length} feeds`);
    const resp = await safeMulticall(calls, this.provider);
    for (let i = 0; i < resp.length; i++) {
      let dataFeedId = resp[i].value || null;
      let feedAddress = calls[i].address;
      if (dataFeedId) {
        dataFeedId = utils
          .toUtf8String(dataFeedId)
          .trim()
          .replace(/\u0000/g, "");
      }
      for (const f of Object.values(this.#feeds)) {
        if (f.main.address === feedAddress) {
          f.main.dataFeedId = dataFeedId;
        }
        if (f.reserve?.address === feedAddress) {
          f.reserve.dataFeedId = dataFeedId;
        }
      }
    }
  }

  #setFeedStatus(e: SetReservePriceFeedStatusEvent): void {
    const token = e.args.token.toLowerCase();
    const active = e.args.active;
    const entry = this.#feeds[token];
    if (!entry) {
      throw new Error(
        `cannot set reserve price feed status for token ${token}`,
      );
    }
    entry.active = active ? "reserve" : "main";
    if (!entry[entry.active]) {
      throw new Error(
        `cannot set status for token ${token}: ${entry.active} price feed address not set`,
      );
    }
  }

  private get oracle(): IPriceOracleV3 {
    if (!this.#oracle) {
      throw new Error(`oracle serive is not launched`);
    }
    return this.#oracle;
  }

  private get provider(): providers.Provider {
    if (!this.#provider) {
      throw new Error(`oracle serive is not launched`);
    }
    return this.#provider;
  }
}
