import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import { ADDRESS_0X0 } from "@gearbox-protocol/sdk-gov";
import {
  iPriceFeedAbi,
  iPriceOracleV3EventsAbi,
  iRedstonePriceFeedAbi,
} from "@gearbox-protocol/types/abi";
import type { ExtractAbiEvent } from "abitype";
import { Inject, Service } from "typedi";
import type { Address, Log } from "viem";
import { bytesToString, hexToBytes } from "viem";

import { CONFIG, type Config } from "../config/index.js";
import type { CreditAccountData } from "../data/index.js";
import { Logger, type LoggerInterface } from "../log/index.js";
import { TxParser } from "../utils/ethers-6-temp/txparser/index.js";
import { AddressProviderService } from "./AddressProviderService.js";
import Client from "./Client.js";

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
  token: Address;
  dataFeedId: string;
  reserve: boolean;
}

interface OracleEntry {
  main: PriceFeedEntry;
  reserve?: PriceFeedEntry;
  active: "main" | "reserve";
}

const ORACLE_START_BLOCK: Record<NetworkType, bigint> = {
  Mainnet: 18797638n,
  Optimism: 116864678n, // not deployed yet, arbitrary block here
  Arbitrum: 184650373n,
  Base: 12299805n, // not deployed yet, arbitrary block here
};

@Service()
export default class OracleServiceV3 {
  @Logger("ScanServiceV3")
  log: LoggerInterface;

  @Inject(CONFIG)
  config: Config;

  @Inject()
  client: Client;

  @Inject()
  addressProvider: AddressProviderService;

  #oracle?: Address;
  #lastBlock = 0n;

  #feeds: Record<Address, OracleEntry> = {};

  public async launch(block: bigint): Promise<void> {
    this.#lastBlock = ORACLE_START_BLOCK[this.config.network];
    this.#oracle = await this.addressProvider.findService("PRICE_ORACLE", 300);
    this.log.debug(`starting oracle v3 at ${block}`);
    await this.#updateFeeds(block);
    this.log.info(`started with ${Object.keys(this.#feeds).length} tokens`);

    // TODO: this is for debug, remove
    const pft = await this.client.pub.readContract({
      abi: iPriceFeedAbi,
      address: "0xE36E70a5c70415AD268b598568aB4A24F5A8BCDd",
      functionName: "priceFeedType",
    });
    this.log.debug(
      `price feed type of "0xE36E70a5c70415AD268b598568aB4A24F5A8BCDd": ${pft}`,
    );

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

  async #updateFeeds(toBlock: bigint): Promise<void> {
    if (toBlock <= this.#lastBlock) {
      return;
    }
    this.log.debug(`updating price feeds in [${this.#lastBlock}, ${toBlock}]`);
    const logs = await this.client.pub.getLogs({
      address: this.oracle,
      events: iPriceOracleV3EventsAbi,
      fromBlock: BigInt(this.#lastBlock),
      toBlock: BigInt(toBlock),
    });
    this.log.debug(`found ${logs.length} oracle events`);
    for (const l of logs) {
      switch (l.eventName) {
        case "SetPriceFeed":
          await this.#setPriceFeed(l);
          break;
        case "SetReservePriceFeed":
          await this.#setPriceFeed(l);
          break;
        case "SetReservePriceFeedStatus":
          this.#setFeedStatus(l);
          break;
      }
    }
    await this.#loadRedstoneIds();
    this.#lastBlock = toBlock;
  }

  async #setPriceFeed(
    e:
      | Log<
          bigint,
          number,
          boolean,
          ExtractAbiEvent<typeof iPriceOracleV3EventsAbi, "SetPriceFeed">
        >
      | Log<
          bigint,
          number,
          boolean,
          ExtractAbiEvent<typeof iPriceOracleV3EventsAbi, "SetReservePriceFeed">
        >,
  ): Promise<void> {
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
