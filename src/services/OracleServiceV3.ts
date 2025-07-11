import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import { ADDRESS_0X0 } from "@gearbox-protocol/sdk-gov";
import {
  iPriceOracleV3EventsAbi,
  iRedstonePriceFeedAbi,
} from "@gearbox-protocol/types/abi";
import type { ExtractAbiEvent } from "abitype";
import type { Address, Log } from "viem";
import { bytesToString, hexToBytes } from "viem";

import type { Config } from "../config/index.js";
import type { CreditAccountData } from "../data/index.js";
import { DI } from "../di.js";
import type { ILogger } from "../log/index.js";
import { Logger } from "../log/index.js";
import { json_parse } from "../utils/bigint-serializer.js";
import { TxParser } from "../utils/ethers-6-temp/txparser/index.js";
import { getLogsPaginated } from "../utils/getLogsPaginated.js";
import type { AddressProviderService } from "./AddressProviderService.js";
import type Client from "./Client.js";
import oracleLogsArbitrum from "./data/oracle-logs-arbitrum.json" assert { type: "json" };
import oracleLogsMainnet from "./data/oracle-logs-mainnet.json" assert { type: "json" };
import oracleLogsOptimism from "./data/oracle-logs-optimism.json" assert { type: "json" };

interface DataFeedMulticall {
  abi: typeof iRedstonePriceFeedAbi;
  address: Address;
  functionName: "dataFeedId";
}

interface PriceFeedEntry {
  address: Address;
  /**
   * Is set for redstone feeds, null for non-redstone feeds, undefined if unknown
   */
  dataFeedId?: string | null;
  trusted?: boolean;
}

export interface RedstoneFeed {
  /**
   * Can be real token or ticker address
   */
  token: Address;
  dataFeedId: string;
  reserve: boolean;
  /**
   * Feed address
   */
  address: Address;
}

interface OracleEntry {
  main: PriceFeedEntry;
  reserve?: PriceFeedEntry;
  active: "main" | "reserve";
}

const ORACLE_START_BLOCK: Record<NetworkType, bigint> = {
  Mainnet: 18797638n,
  Optimism: 118413958n,
  Arbitrum: 184650373n,
  Base: 12299805n, // not deployed yet, arbitrary block here
  Sonic: 8897028n, // not deployed yet, arbitrary block here
};

type PriceFeedEvent =
  | Log<
      bigint,
      number,
      boolean,
      ExtractAbiEvent<typeof iPriceOracleV3EventsAbi, "SetPriceFeed">,
      true
    >
  | Log<
      bigint,
      number,
      boolean,
      ExtractAbiEvent<typeof iPriceOracleV3EventsAbi, "SetReservePriceFeed">,
      true
    >;

type OracleEvent =
  | PriceFeedEvent
  | Log<
      bigint,
      number,
      boolean,
      ExtractAbiEvent<
        typeof iPriceOracleV3EventsAbi,
        "SetReservePriceFeedStatus"
      >,
      true
    >;

interface EventsCache {
  fromBlock: bigint;
  toBlock: bigint;
  logs: OracleEvent[];
}

const EVENTS_CACHE: Partial<Record<NetworkType, EventsCache>> = {
  Mainnet: json_parse(JSON.stringify(oracleLogsMainnet)),
  Arbitrum: json_parse(JSON.stringify(oracleLogsArbitrum)),
  Optimism: json_parse(JSON.stringify(oracleLogsOptimism)),
};

@DI.Injectable(DI.Oracle)
export default class OracleServiceV3 {
  @Logger("Oracle")
  log!: ILogger;

  @DI.Inject(DI.Config)
  config!: Config;

  @DI.Inject(DI.Client)
  client!: Client;

  @DI.Inject(DI.AddressProvider)
  addressProvider!: AddressProviderService;

  #oracle?: Address;
  #lastBlock = 0n;

  #feeds: Record<Address, OracleEntry> = {};

  public async launch(block: bigint): Promise<void> {
    this.#oracle = this.addressProvider.findService("PRICE_ORACLE", 300);
    this.log.debug(`starting oracle v3 at ${block}`);
    this.#loadCachedEvents();
    await this.#updateFeeds(block);
    this.log.info(`started with ${Object.keys(this.#feeds).length} tokens`);

    // TODO: TxParser is really old and weird class, until we refactor it it's the best place to have this
    TxParser.addTokens(this.config.network);
    TxParser.addPriceOracle(this.#oracle);
  }

  public async update(blockNumber: bigint): Promise<void> {
    await this.#updateFeeds(blockNumber);
  }

  /**
   * Checks if token is present in price oracle
   * @param token
   * @returns
   */
  public hasFeed(token: string): boolean {
    return !!this.#feeds[token.toLowerCase() as Address];
  }

  // TODO: exposed for hotfix only
  public getFeed(token: string): OracleEntry {
    return this.#feeds[token.toLowerCase() as Address]!;
  }

  /**
   * Returns false if account has tokens without reserve price feeds for some tokens
   * @param ca
   * @returns
   */
  public checkReserveFeeds(ca: CreditAccountData): boolean {
    for (const { token, balance } of ca.allBalances) {
      if (token === ca.underlyingToken) {
        continue;
      }
      if (balance < 10n) {
        continue;
      }
      const entry = this.#feeds[token];
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
    const result: Record<Address, RedstoneFeed[]> = {};
    for (const [t, entry] of Object.entries(this.#feeds)) {
      const token = t.toLowerCase() as Address;
      const { active, main, reserve } = entry;
      if (main.dataFeedId && (!activeOnly || active === "main")) {
        result[token] = [
          ...(result[token] ?? []),
          {
            token,
            address: main.address,
            dataFeedId: main.dataFeedId,
            reserve: false,
          },
        ];
      }
      if (reserve?.dataFeedId && (!activeOnly || active === "reserve")) {
        result[token] = [
          ...(result[token] ?? []),
          {
            token,
            address: reserve.address,
            dataFeedId: reserve.dataFeedId,
            reserve: true,
          },
        ];
      }
    }
    return result;
  }

  async #updateFeeds(toBlock: bigint): Promise<void> {
    if (toBlock <= this.#lastBlock) {
      return;
    }
    this.log.debug(`updating price feeds in [${this.#lastBlock}, ${toBlock}]`);
    let logs = await getLogsPaginated(this.client.logs, {
      address: this.oracle,
      events: iPriceOracleV3EventsAbi,
      fromBlock: BigInt(this.#lastBlock),
      toBlock: BigInt(toBlock),
      strict: true,
      pageSize: this.config.logsPageSize,
    });

    // sort logs by blockNumber ASC, logIndex ASC
    // on sonic sometimes events are not in order
    logs = logs.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return a.blockNumber < b.blockNumber ? -1 : 1;
      }
      return a.logIndex < b.logIndex ? -1 : 1;
    });

    this.log.debug(`found ${logs.length} oracle events`);
    for (const l of logs) {
      this.#processEvent(l);
    }
    await this.#loadRedstoneIds();
    this.#lastBlock = toBlock;
  }

  // this is temporary workaround to speed up loading
  // we would not need to maintain it for long time, because 3.1 is coming
  #loadCachedEvents(): void {
    const cache = EVENTS_CACHE[this.config.network];
    if (!cache) {
      this.#lastBlock = ORACLE_START_BLOCK[this.config.network];
      return;
    }
    const { toBlock, logs } = cache;
    this.#lastBlock = toBlock;
    for (const l of logs) {
      this.#processEvent(l);
    }
    this.log.debug(
      `loaded ${logs.length} cached events, last block ${toBlock}`,
    );
  }

  #processEvent(l: OracleEvent): void {
    switch (l.eventName) {
      case "SetPriceFeed":
        this.#setPriceFeed(l);
        break;
      case "SetReservePriceFeed":
        this.#setPriceFeed(l);
        break;
      case "SetReservePriceFeedStatus":
        this.#setFeedStatus(l);
        break;
    }
  }

  #setPriceFeed(e: PriceFeedEvent): void {
    const kind = e.eventName === "SetPriceFeed" ? "main" : "reserve";
    const token = e.args.token?.toLowerCase() as Address;
    if (!token) {
      throw new Error("token argument not found");
    }
    const priceFeed = e.args.priceFeed?.toLowerCase() as Address;
    if (!priceFeed) {
      throw new Error("priceFeed argument not found");
    }
    let entry = this.#feeds[token];
    if (!entry) {
      if (kind === "reserve") {
        throw new Error(
          `cannot add reserve price feed ${priceFeed} for token ${token} because main price feed is not added yet`,
        );
      }
      const trusted = "trusted" in e.args && !!e.args.trusted;
      entry = {
        active: "main",
        main: {
          address: priceFeed,
          trusted,
        },
      };
    }
    entry[kind] = { address: priceFeed };
    this.#feeds[token] = entry;
  }

  async #loadRedstoneIds(): Promise<void> {
    const calls: DataFeedMulticall[] = [];
    for (const f of Object.values(this.#feeds)) {
      if (f.main.dataFeedId === undefined) {
        calls.push({
          address: f.main.address,
          abi: iRedstonePriceFeedAbi,
          functionName: "dataFeedId",
        });
      }
      if (!!f.reserve && f.reserve.dataFeedId === undefined) {
        calls.push({
          address: f.reserve.address,
          abi: iRedstonePriceFeedAbi,
          functionName: "dataFeedId",
        });
      }
    }
    this.log.debug(`need to get redstone data ids on ${calls.length} feeds`);
    const resp = await this.client.pub.multicall({
      contracts: calls,
      allowFailure: true,
    });
    for (let i = 0; i < resp.length; i++) {
      let dataFeedId: string | null =
        (resp[i].status === "success" ? resp[i].result : null) ?? null;
      let feedAddress = calls[i].address;
      if (dataFeedId) {
        dataFeedId = bytesToString(hexToBytes(dataFeedId as `0x${string}`))
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

  #setFeedStatus(
    e: Log<
      bigint,
      number,
      boolean,
      ExtractAbiEvent<
        typeof iPriceOracleV3EventsAbi,
        "SetReservePriceFeedStatus"
      >
    >,
  ): void {
    const token = e.args.token?.toLowerCase() as Address;
    if (!token) {
      throw new Error("token argument not found");
    }
    const active = !!e.args.active;
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

  private get oracle(): Address {
    if (!this.#oracle) {
      throw new Error(`oracle service is not launched`);
    }
    return this.#oracle;
  }
}
