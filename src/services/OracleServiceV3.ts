import type { MCall, NetworkType } from "@gearbox-protocol/sdk-gov";
import { ADDRESS_0X0, safeMulticall, WAD } from "@gearbox-protocol/sdk-gov";
import type {
  IPriceOracleV3,
  IRedstonePriceFeed,
} from "@gearbox-protocol/types/v3";
import {
  IPriceOracleV3__factory,
  IRedstonePriceFeed__factory,
} from "@gearbox-protocol/types/v3";
import type { LogDescription } from "ethers";
import { Provider, toUtf8String } from "ethers";
import { Inject, Service } from "typedi";

import { CONFIG, type ConfigSchema } from "../config";
import { Logger, type LoggerInterface } from "../log";
import { PROVIDER } from "../utils";
import type { CreditAccountData } from "../utils/ethers-6-temp";
import { TxParser } from "../utils/ethers-6-temp/txparser";
import { AddressProviderService } from "./AddressProviderService";

const IRedstonePriceFeedInterface =
  IRedstonePriceFeed__factory.createInterface();
const IPriceOracleV3Interface = IPriceOracleV3__factory.createInterface();

interface PriceFeedEntry {
  address: string;
  /**
   * Is set for redstone feeds, null for non-redstone feeds, undefined if unknown
   */
  dataFeedId?: string | null;
  trusted?: boolean;
}

export interface RedstoneFeed {
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

  @Inject(PROVIDER)
  provider: Provider;

  @Inject(CONFIG)
  config: ConfigSchema;

  #oracle?: IPriceOracleV3;
  #lastBlock = 0;

  #feeds: Record<string, OracleEntry> = {};
  // underlying (=tokenTo) -> token -> token price in underlying
  #priceCache: Record<string, Record<string, bigint>> = {};

  public async launch(block: number): Promise<void> {
    this.#lastBlock = ORACLE_START_BLOCK[this.addressProvider.network];
    const oracle = await this.addressProvider.findService("PRICE_ORACLE", 300);
    this.#oracle = IPriceOracleV3__factory.connect(oracle, this.provider);
    this.log.debug(`starting oracle v3 at ${block}`);
    await this.#updateFeeds(block);
    this.log.info(`started with ${Object.keys(this.#feeds).length} tokens`);

    // TODO: TxParser is really old and weird class, until we refactor it it's the best place to have this
    TxParser.addTokens(this.addressProvider.network);
    TxParser.addPriceOracle(oracle);
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
    const calls: MCall<IPriceOracleV3["interface"]>[] = [];
    const result: Record<string, bigint> = {};

    for (const [tokenFrom, amount] of Object.entries(tokensFrom)) {
      const fromCache = this.#convertCached(tokenFrom, tokenTo, amount);
      if (tokenFrom.toLowerCase() === tokenTo.toLowerCase()) {
        result[tokenTo.toLowerCase()] = amount;
      } else if (this.config.optimistic && !!fromCache) {
        result[tokenFrom.toLowerCase()] = fromCache;
      } else {
        calls.push({
          address: this.oracle.target as string,
          interface: this.oracle.interface,
          method: "convert",
          params: [amount, tokenFrom, tokenTo],
        });
      }
    }
    this.log.debug(`need to peform convert on ${calls.length} feeds`);
    const resp = await safeMulticall<bigint>(calls, this.provider);

    for (let i = 0; i < resp.length; i++) {
      const { value, error } = resp[i];
      const amountFrom = calls[i].params[0] as bigint;
      const tokenFrom = calls[i].params[1] as string;
      if (!error && !!value) {
        result[tokenFrom.toLowerCase()] = value;
        if (this.config.optimistic) {
          this.#saveCached(tokenFrom, tokenTo, amountFrom, value);
        }
      }
    }

    return result;
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
   * For single token, it can include multiple feeds (main and/or reserve)
   */
  public getRedstoneFeeds(activeOnly: boolean): Record<string, RedstoneFeed[]> {
    const result: Record<string, RedstoneFeed[]> = {};
    for (const [t, entry] of Object.entries(this.#feeds)) {
      const token = t.toLowerCase();
      const { active, main, reserve } = entry;
      if (main.dataFeedId && (!activeOnly || active === "main")) {
        result[token] = [
          ...(result[token] ?? []),
          { token, dataFeedId: main.dataFeedId, reserve: false },
        ];
      }
      if (reserve?.dataFeedId && (!activeOnly || active === "reserve")) {
        result[token] = [
          ...(result[token] ?? []),
          { token, dataFeedId: reserve.dataFeedId, reserve: true },
        ];
      }
    }
    return result;
  }

  async #updateFeeds(toBlock: number): Promise<void> {
    if (toBlock <= this.#lastBlock) {
      return;
    }
    this.log.debug(`updating price feeds in [${this.#lastBlock}, ${toBlock}]`);
    const logs = await this.provider.getLogs({
      address: this.oracle.getAddress(),
      fromBlock: this.#lastBlock,
      toBlock,
    });
    this.log.debug(`found ${logs.length} oracle events`);
    for (const l of logs) {
      const e = IPriceOracleV3Interface.parseLog(l);
      switch (e?.name) {
        case "SetPriceFeed":
          await this.#setPriceFeed(e);
          break;
        case "SetReservePriceFeed":
          await this.#setPriceFeed(e);
          break;
        case "SetReservePriceFeedStatus":
          this.#setFeedStatus(e);
          break;
      }
    }
    await this.#loadRedstoneIds();
    this.#lastBlock = toBlock;
  }

  async #setPriceFeed(e: LogDescription): Promise<void> {
    const kind = e.name === "SetPriceFeed" ? "main" : "reserve";
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
          trusted: e.args.trusted,
        },
      };
    }
    entry[kind] = { address: priceFeed };
    this.#feeds[token] = entry;
  }

  async #loadRedstoneIds(): Promise<void> {
    const calls: MCall<IRedstonePriceFeed["interface"]>[] = [];
    for (const f of Object.values(this.#feeds)) {
      if (f.main.dataFeedId === undefined) {
        calls.push({
          address: f.main.address,
          interface: IRedstonePriceFeedInterface,
          method: "dataFeedId",
        });
      }
      if (!!f.reserve && f.reserve.dataFeedId === undefined) {
        calls.push({
          address: f.reserve.address,
          interface: IRedstonePriceFeedInterface,
          method: "dataFeedId",
        });
      }
    }
    this.log.debug(`need to get redstone data ids on ${calls.length} feeds`);
    const resp = await safeMulticall(calls, this.provider);
    for (let i = 0; i < resp.length; i++) {
      let dataFeedId = resp[i].value || null;
      let feedAddress = calls[i].address;
      if (dataFeedId) {
        dataFeedId = toUtf8String(dataFeedId)
          .trim()
          .replace(/\u0000/g, "");
      }
      for (const f of Object.values(this.#feeds)) {
        if (f.main.address === feedAddress) {
          f.main.dataFeedId = dataFeedId;
        }
        if (f.reserve?.address === feedAddress) {
          f.reserve!.dataFeedId = dataFeedId;
        }
      }
    }
  }

  #setFeedStatus(e: LogDescription): void {
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

  #convertCached(
    tokenFrom: string,
    tokenTo: string,
    amountFrom: bigint,
  ): bigint | undefined {
    const price =
      this.#priceCache[tokenTo.toLowerCase()]?.[tokenFrom.toLowerCase()];
    if (!price) {
      return undefined;
    }
    return (amountFrom * price) / WAD;
  }

  #saveCached(
    tokenFrom: string,
    tokenTo: string,
    amountFrom: bigint,
    amountTo: bigint,
  ): void {
    const price = (WAD * amountTo) / amountFrom;
    const froms = this.#priceCache[tokenTo.toLowerCase()] ?? {};
    froms[tokenFrom.toLowerCase()] = price;
    this.#priceCache[tokenTo.toLowerCase()] = froms;
  }

  private get oracle(): IPriceOracleV3 {
    if (!this.#oracle) {
      throw new Error(`oracle serive is not launched`);
    }
    return this.#oracle;
  }
}
