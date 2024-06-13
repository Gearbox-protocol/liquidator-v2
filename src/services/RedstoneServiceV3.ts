import {
  getTokenSymbolOrTicker,
  type PriceFeedData,
  type PriceFeedType,
  REDSTONE_SIGNERS,
  tickerInfoTokensByNetwork,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk-gov";
import { iCreditFacadeV3MulticallAbi } from "@gearbox-protocol/types/abi";
import { DataServiceWrapper } from "@redstone-finance/evm-connector";
import { RedstonePayload } from "redstone-protocol";
import { Inject, Service } from "typedi";
import type { Address, TestClient } from "viem";
import {
  bytesToString,
  createTestClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  parseAbiParameters,
  PublicClient,
  toBytes,
} from "viem";

import { CONFIG, type Config } from "../config/index.js";
import type {
  CreditAccountData,
  MultiCall,
  PriceOnDemand,
} from "../data/index.js";
import { Logger, type LoggerInterface } from "../log/index.js";
import { formatTs, VIEM_PUBLIC_CLIENT } from "../utils/index.js";
import { AddressProviderService } from "./AddressProviderService.js";
import ExecutorService from "./ExecutorService.js";
import type { PriceOnDemandExtras, PriceUpdate } from "./liquidate/index.js";
import type { RedstoneFeed } from "./OracleServiceV3.js";
import OracleServiceV3 from "./OracleServiceV3.js";

export type RedstonePriceFeed = Extract<
  PriceFeedData,
  { type: PriceFeedType.REDSTONE_ORACLE }
>;

@Service()
export class RedstoneServiceV3 {
  @Logger("RedstoneServiceV3")
  log: LoggerInterface;

  @Inject(CONFIG)
  config: Config;

  @Inject()
  oracle: OracleServiceV3;

  @Inject()
  addressProvider: AddressProviderService;

  @Inject()
  executor: ExecutorService;

  @Inject(VIEM_PUBLIC_CLIENT)
  publicClient: PublicClient;

  #anvilClient?: TestClient<"anvil">;

  /**
   * Timestamp to use to get historical data instead in optimistic mode, so that we use the same redstone data for all the liquidations
   */
  #optimisticTimestamp?: number;
  #optimisticCache: Map<string, PriceOnDemandExtras> = new Map();

  public async launch(): Promise<void> {
    this.liquidationPreviewUpdates = this.liquidationPreviewUpdates.bind(this);

    if (this.config.optimistic) {
      this.#anvilClient = createTestClient({
        transport: http(this.config.ethProviderRpcs[0], { timeout: 120_000 }),
        mode: "anvil",
        chain: this.publicClient.chain,
      });
      const block = await this.publicClient.getBlock({
        blockNumber: this.executor.anvilForkBlock,
      });
      if (!block) {
        throw new Error(`cannot get latest block`);
      }
      // we round the timestamp to full minutes for being compatible with
      // oracle-nodes, which usually work with rounded 10s and 60s intervals
      this.#optimisticTimestamp =
        10 * Math.floor(Number(block.timestamp) / 10) * 1000;
      this.log.info(
        `will use optimistic timestamp: ${this.#optimisticTimestamp}`,
      );
    }
  }

  public async updatesForTokens(
    tokens: string[],
    activeOnly: boolean,
  ): Promise<PriceOnDemandExtras[]> {
    const redstoneFeeds = this.oracle.getRedstoneFeeds(activeOnly);
    const tickers = tickerInfoTokensByNetwork[this.config.network];

    const redstoneUpdates: RedstoneFeed[] = [];
    for (const t of tokens) {
      const token = t.toLowerCase();
      const feeds = redstoneFeeds[token];
      if (feeds?.length) {
        redstoneUpdates.push(...feeds);
        continue;
      }
      const symb = tokenSymbolByAddress[token];
      const ticker = tickers[symb];
      if (ticker) {
        if (this.oracle.hasFeed(ticker.address)) {
          this.log.debug(
            `will update redstone ticker ${ticker.symbol} for ${symb}`,
          );
          redstoneUpdates.push({
            dataFeedId: ticker.dataId,
            token: ticker.address,
            reserve: false, // tickers are always added as main feed
          });
        } else {
          this.log.debug(
            `ticker ${ticker.symbol} for ${symb} is not registered in price oracle, skipping`,
          );
        }
      }
    }
    if (!redstoneUpdates.length) {
      return [];
    }

    this.log?.debug(
      `need to update ${redstoneUpdates.length} redstone feeds: ${printFeeds(redstoneUpdates)}`,
    );
    const result = await Promise.all(
      redstoneUpdates.map(({ token, dataFeedId, reserve }) =>
        this.#getRedstonePayloadForManualUsage(
          token,
          reserve,
          "redstone-primary-prod",
          dataFeedId,
          REDSTONE_SIGNERS.signersThreshold,
        ),
      ),
    );

    if (this.config.optimistic && result.length > 0) {
      const redstoneTs = minTimestamp(result);
      // On anvil fork of L2, block.number is anvil block
      let block = await this.publicClient.getBlock({ blockTag: "latest" });
      if (!block) {
        throw new Error("cannot get latest block");
      }
      const delta = Number(block.timestamp) - redstoneTs;
      const realtimeDelta = Math.floor(
        new Date().getTime() / 1000 - redstoneTs,
      );
      this.log.debug(
        { tag: "timing" },
        `redstone delta ${delta} (realtime ${realtimeDelta}) for block ${formatTs(block)}: ${result.map(formatTs)}`,
      );
      if (delta < 0) {
        this.log?.debug(
          { tag: "timing" },
          `warp, because block ts ${formatTs(block)} < ${formatTs(redstoneTs)} redstone ts (${Math.ceil(-delta / 60)} min)`,
        );
        await this.anvilClient.setNextBlockTimestamp({
          timestamp: BigInt(redstoneTs),
        });
        block = await this.publicClient.getBlock({ blockTag: "latest" });
        this.log?.debug({ tag: "timing" }, `new block ts: ${formatTs(block)}`);
      }
    }

    return result;
  }

  public async multicallUpdates(ca: CreditAccountData): Promise<MultiCall[]> {
    const priceUpdates = await this.liquidationPreviewUpdates(ca, true);
    return priceUpdates.map(({ token, data, reserve }) => ({
      target: ca.creditFacade,
      callData: encodeFunctionData({
        abi: iCreditFacadeV3MulticallAbi,
        functionName: "onDemandPriceUpdate",
        args: [token, reserve, data],
      }),
    }));
  }

  public async dataCompressorUpdates(
    ca: CreditAccountData,
  ): Promise<PriceOnDemand[]> {
    const priceUpdates = await this.liquidationPreviewUpdates(ca, true);
    return priceUpdates.map(({ token, data }) => ({
      token,
      callData: data,
    }));
  }

  public async liquidationPreviewUpdates(
    ca: CreditAccountData,
    activeOnly = false,
  ): Promise<PriceUpdate[]> {
    const accTokens: string[] = [];
    for (const { token, balance, isEnabled } of ca.allBalances) {
      if (isEnabled && balance > 10n) {
        accTokens.push(token);
      }
    }
    const priceUpdates = await this.updatesForTokens(accTokens, activeOnly);
    return priceUpdates.map(({ token, reserve, callData }) => ({
      token: token as Address,
      reserve,
      data: callData,
    }));
  }

  async #getRedstonePayloadForManualUsage(
    token: Address,
    reserve: boolean,
    dataServiceId: string,
    dataFeedId: string,
    uniqueSignersCount: number,
  ): Promise<PriceOnDemandExtras> {
    const key = redstoneCacheKey(
      token,
      reserve,
      dataServiceId,
      dataFeedId,
      uniqueSignersCount,
    );
    if (this.config.optimistic) {
      if (this.#optimisticCache.has(key)) {
        this.log.debug(`using cached response for ${key}`);
        return this.#optimisticCache.get(key)!;
      }
    }

    const dataPayload = await new DataServiceWrapper({
      dataServiceId,
      dataFeeds: [dataFeedId],
      uniqueSignersCount,
      historicalTimestamp: this.#optimisticTimestamp,
    }).prepareRedstonePayload(true);

    const { signedDataPackages, unsignedMetadata } = RedstonePayload.parse(
      toBytes(`0x${dataPayload}`),
    );

    const dataPackagesList = splitResponse(
      signedDataPackages,
      uniqueSignersCount,
    );

    const result = dataPackagesList.map(list => {
      const payload = new RedstonePayload(
        list,
        bytesToString(unsignedMetadata),
      );

      let ts = 0;
      list.forEach(p => {
        const newTimestamp = p.dataPackage.timestampMilliseconds / 1000;
        if (ts === 0) {
          ts = newTimestamp;
        } else if (ts !== newTimestamp) {
          throw new Error("Timestamps are not equal");
        }
      });

      return [
        encodeAbiParameters(parseAbiParameters("uint256, bytes"), [
          BigInt(ts),
          `0x${payload.toBytesHexWithout0xPrefix()}`,
        ]),
        ts,
      ] as const;
    });

    const response = {
      token,
      reserve,
      callData: result[0][0],
      ts: result[0][1],
    };

    if (this.config.optimistic) {
      this.#optimisticCache.set(key, response);
    }

    return response;
  }

  private get anvilClient(): TestClient<"anvil"> {
    if (!this.#anvilClient) {
      throw new Error("anvil client not initalized");
    }
    return this.#anvilClient;
  }
}

function redstoneCacheKey(
  token: Address,
  reserve: boolean,
  dataServiceId: string,
  dataFeedId: string,
  uniqueSignersCount: number,
): string {
  return [
    getTokenSymbolOrTicker(token),
    reserve ? "reserve" : "main",
    dataServiceId,
    dataFeedId,
    uniqueSignersCount,
  ].join("|");
}

function splitResponse<T>(arr: T[], size: number): T[][] {
  const chunks = [];

  for (let i = 0; i < arr.length; i += size) {
    const chunk = arr.slice(i, i + size);
    chunks.push(chunk);
  }

  return chunks;
}

function printFeeds(feeds: RedstoneFeed[]): string {
  return feeds
    .map(
      f =>
        `${getTokenSymbolOrTicker(f.token)} ${f.reserve ? "reserve" : "main"} -> ${f.dataFeedId}`,
    )
    .join(", ");
}

function minTimestamp(updates: PriceOnDemandExtras[]): number {
  let result = Number.POSITIVE_INFINITY;
  for (const { ts } of updates) {
    result = Math.min(result, ts);
  }
  return result;
}
