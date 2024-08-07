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
import type { Address } from "viem";
import {
  bytesToString,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbiParameters,
  toBytes,
  toHex,
} from "viem";

import type { Config } from "../config/index.js";
import type {
  CreditAccountData,
  MultiCall,
  PriceOnDemand,
} from "../data/index.js";
import { DI } from "../di.js";
import { type ILogger, Logger } from "../log/index.js";
import { formatTs } from "../utils/index.js";
import type { AddressProviderService } from "./AddressProviderService.js";
import type Client from "./Client.js";
import type { PriceOnDemandExtras, PriceUpdate } from "./liquidate/index.js";
import type { RedstoneFeed } from "./OracleServiceV3.js";
import type OracleServiceV3 from "./OracleServiceV3.js";

export type RedstonePriceFeed = Extract<
  PriceFeedData,
  { type: PriceFeedType.REDSTONE_ORACLE }
>;

const HISTORICAL_BLOCKLIST = new Set<string>([
  // "rsETH_FUNDAMENTAL",
  // "weETH_FUNDAMENTAL",
  // "ezETH_FUNDAMENTAL",
]);

@DI.Injectable(DI.Redstone)
export class RedstoneServiceV3 {
  @Logger("Redstone")
  logger!: ILogger;

  @DI.Inject(DI.Config)
  config!: Config;

  @DI.Inject(DI.Oracle)
  oracle!: OracleServiceV3;

  @DI.Inject(DI.AddressProvider)
  addressProvider!: AddressProviderService;

  @DI.Inject(DI.Client)
  client!: Client;

  /**
   * Timestamp (in ms) to use to get historical data instead in optimistic mode, so that we use the same redstone data for all the liquidations
   */
  #optimisticTimestamp?: number;
  #optimisticCache: Map<string, PriceOnDemandExtras> = new Map();

  public async launch(): Promise<void> {
    this.liquidationPreviewUpdates = this.liquidationPreviewUpdates.bind(this);

    if (this.config.optimistic) {
      const block = await this.client.pub.getBlock({
        blockNumber: this.client.anvilForkBlock,
      });
      if (!block) {
        throw new Error("cannot get latest block");
      }
      this.logger.info(
        { tag: "timing" },
        `optimistic fork block ${block.number} ${new Date(Number(block.timestamp) * 1000)}`,
      );
      // https://github.com/redstone-finance/redstone-oracles-monorepo/blob/c7569a8eb7da1d3ad6209dfcf59c7ca508ea947b/packages/sdk/src/request-data-packages.ts#L82
      // we round the timestamp to full minutes for being compatible with
      // oracle-nodes, which usually work with rounded 10s and 60s intervals
      //
      // Also, when forking anvil->anvil (when running on testnets) block.timestamp can be in future because min ts for block is 1 seconds,
      // and scripts can take dozens of blocks (hundreds for faucet). So we take min value;
      const nowMs = new Date().getTime();
      const redstoneIntervalMs = 60_000;
      const anvilTsMs =
        redstoneIntervalMs *
        Math.floor((Number(block.timestamp) * 1000) / redstoneIntervalMs);
      const fromNowTsMs =
        redstoneIntervalMs * Math.floor(nowMs / redstoneIntervalMs - 1);
      this.#optimisticTimestamp = Math.min(anvilTsMs, fromNowTsMs);
      const deltaS = Math.floor((nowMs - this.#optimisticTimestamp) / 1000);
      this.logger.info(
        { tag: "timing" },
        `will use optimistic timestamp: ${new Date(this.#optimisticTimestamp)} (${this.#optimisticTimestamp}, delta: ${deltaS}s)`,
      );
    }
  }

  public async updatesForTokens(
    tokens: string[],
    activeOnly: boolean,
    logContext: Record<string, any> = {},
  ): Promise<PriceOnDemandExtras[]> {
    const logger = this.logger.child(logContext);
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
          logger.debug(
            { ticker },
            `will update redstone ticker ${ticker.symbol} for ${symb}`,
          );
          redstoneUpdates.push({
            dataFeedId: ticker.dataId,
            token: ticker.address,
            reserve: false, // tickers are always added as main feed
          });
        } else {
          logger.debug(
            `ticker ${ticker.symbol} for ${symb} is not registered in price oracle, skipping`,
          );
        }
      }
    }
    if (!redstoneUpdates.length) {
      return [];
    }

    logger.debug(
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
          logContext,
        ),
      ),
    );

    if (this.config.optimistic && result.length > 0) {
      const redstoneTs = minTimestamp(result);
      // On anvil fork of L2, block.number is anvil block
      let block = await this.client.pub.getBlock({
        blockTag: "latest",
      });
      if (!block) {
        throw new Error("cannot get latest block");
      }
      const delta = Number(block.timestamp) - redstoneTs;
      const realtimeDelta = Math.floor(
        new Date().getTime() / 1000 - redstoneTs,
      );
      logger.debug(
        { tag: "timing" },
        `redstone delta ${delta} (realtime ${realtimeDelta}) for block ${block.number} ${formatTs(block)}: ${result.map(formatTs)}`,
      );
      if (delta < 0) {
        logger.debug(
          { tag: "timing" },
          `warp, because block ts ${formatTs(block)} < ${formatTs(redstoneTs)} redstone ts (${Math.ceil(-delta / 60)} min)`,
        );
        [block] = await this.client.anvil.request({
          method: "evm_mine_detailed",
          params: [toHex(redstoneTs)],
        });
        logger.debug({ tag: "timing" }, `new block ts: ${formatTs(block)}`);
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
    const priceUpdates = await this.updatesForTokens(accTokens, activeOnly, {
      account: ca.addr,
      borrower: ca.borrower,
      manager: ca.managerName,
    });
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
    logContext: Record<string, any> = {},
  ): Promise<PriceOnDemandExtras> {
    const logger = this.logger.child(logContext);
    const cacheAllowed = this.config.optimistic;
    const key = redstoneCacheKey(
      token,
      reserve,
      dataServiceId,
      dataFeedId,
      uniqueSignersCount,
    );
    if (cacheAllowed) {
      if (this.#optimisticCache.has(key)) {
        logger.debug(`using cached response for ${key}`);
        return this.#optimisticCache.get(key)!;
      }
    }

    const dataPayload = await new DataServiceWrapper({
      dataServiceId,
      dataPackagesIds: [dataFeedId],
      uniqueSignersCount,
      historicalTimestamp: HISTORICAL_BLOCKLIST.has(dataFeedId)
        ? undefined
        : this.#optimisticTimestamp,
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

    if (cacheAllowed) {
      this.#optimisticCache.set(key, response);
    }

    return response;
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
