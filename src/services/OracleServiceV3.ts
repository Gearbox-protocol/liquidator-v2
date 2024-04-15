import type { IPriceOracleV3Interface } from "@gearbox-protocol/liquidator-v2-contracts/dist/IPriceOracleV3.sol/IPriceOracleV3";
import type {
  CreditAccountData,
  IPriceOracleV3,
  MCall,
  NetworkType,
  RedstonePriceFeed,
} from "@gearbox-protocol/sdk";
import {
  ADDRESS_0X0,
  IPriceOracleV3__factory,
  RedstonePriceFeed__factory,
  safeMulticall,
} from "@gearbox-protocol/sdk";
import type {
  SetPriceFeedEvent,
  SetReservePriceFeedEvent,
  SetReservePriceFeedStatusEvent,
} from "@gearbox-protocol/sdk/lib/types/IPriceOracleV3.sol/IPriceOracleV3";
import type { BigNumber } from "ethers";
import { providers, utils } from "ethers";
import { Inject, Service } from "typedi";

import { Logger, LoggerInterface } from "../log";
import { AddressProviderService } from "./AddressProviderService";

const RedstoneInterface = RedstonePriceFeed__factory.createInterface();

interface PriceFeedEntry {
  address: string;
  /**
   * Is set for redstone feeds, null for non-redstone feeds, undefined if unknown
   */
  dataFeedId?: string | null;
  trusted?: boolean;
}

interface RedstoneFeed {
  token: string;
  dataFeedId: string;
  reserve: boolean;
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

  @Inject()
  providerr: providers.Provider;

  #oracle?: IPriceOracleV3;
  #lastBlock = 0;

  #feeds: Record<string, OracleEntry> = {};

  public async launch(block: number): Promise<void> {
    this.#lastBlock = ORACLE_START_BLOCK[this.addressProvider.network];
    const oracle = await this.addressProvider.findService("PRICE_ORACLE", 300);
    this.#oracle = IPriceOracleV3__factory.connect(oracle, this.providerr);
    this.log.debug(`starting oracle v3 at ${block}`);
    await this.#updateFeeds(block);
    this.log.info(`started with ${Object.keys(this.#feeds).length} tokens`);
  }

  public async update(blockNumber: number): Promise<void> {
    await this.#updateFeeds(blockNumber);
  }

  /**
   * Used to convert balances of account to underlying
   * @param tokensFrom
   * @param tokenTo
   * @returns
   */
  public async convertMany(
    tokensFrom: Record<string, bigint>,
    tokenTo: string,
  ): Promise<Record<string, bigint>> {
    const calls: MCall<IPriceOracleV3Interface>[] = [];
    for (const [tokenFrom, amount] of Object.entries(tokensFrom)) {
      calls.push({
        address: this.oracle.address,
        interface: this.oracle.interface,
        method: "convert(uint256,address,address)",
        params: [amount, tokenFrom, tokenTo],
      });
    }
    this.log.debug(`need to get redstone data ids on ${calls.length} feeds`);
    const resp = await safeMulticall<BigNumber>(calls, this.providerr);
    return Object.fromEntries(
      resp
        .map(({ value, error }, i) => [
          calls[i].params[1],
          error ? -1n : value?.toBigInt() ?? -1n,
        ])
        .filter(([_, a]) => a > 0n),
    );
  }

  public checkReserveFeeds(ca: CreditAccountData): boolean {
    for (const [t, b] of Object.entries(ca.balances)) {
      if (t.toLowerCase() === ca.underlyingToken.toLowerCase()) {
        continue;
      }
      if (b < 10n) {
        continue;
      }
      const entry = this.#feeds[t.toLowerCase()];
      if (!entry) {
        return false;
      }
      if (
        !entry.main.trusted &&
        (!entry.reserve || entry.reserve.address === ADDRESS_0X0)
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * Returns currenly used redstone feeds
   */
  public getRedstoneFeeds(activeOnly: boolean): RedstoneFeed[] {
    const result: RedstoneFeed[] = [];
    for (const [token, entry] of Object.entries(this.#feeds)) {
      const { active, main, reserve } = entry;
      if (main.dataFeedId && (!activeOnly || active === "main")) {
        result.push({ token, dataFeedId: main.dataFeedId, reserve: false });
      }
      if (reserve?.dataFeedId && (!activeOnly || active === "reserve")) {
        result.push({ token, dataFeedId: reserve.dataFeedId, reserve: true });
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
      entry = {
        active: "main",
        main: {
          address: priceFeed,
          trusted: (e as SetPriceFeedEvent).args.trusted,
        },
      };
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
    const resp = await safeMulticall(calls, this.providerr);
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
}
