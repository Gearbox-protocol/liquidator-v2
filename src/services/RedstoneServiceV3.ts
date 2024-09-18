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
import type { SignedDataPackage } from "redstone-protocol";
import { RedstonePayload } from "redstone-protocol";
import type { Address } from "viem";
import {
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
import { formatTs, retry } from "../utils/index.js";
import type { AddressProviderService } from "./AddressProviderService.js";
import type Client from "./Client.js";
import type { PriceOnDemandExtras, PriceUpdate } from "./liquidate/index.js";
import type { RedstoneFeed } from "./OracleServiceV3.js";
import type OracleServiceV3 from "./OracleServiceV3.js";

interface TimestampedCalldata {
  callData: `0x${string}`;
  ts: number;
}

interface RedstoneUpdate extends RedstoneFeed {
  /**
   * In case when Redstone feed is using ticker to updates, this will be the original token
   * Otherwise they are the same
   */
  originalToken: Address;
}

export type RedstonePriceFeed = Extract<
  PriceFeedData,
  { type: PriceFeedType.REDSTONE_ORACLE }
>;

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
    tokens: Address[],
    activeOnly: boolean,
    logContext: Record<string, any> = {},
  ): Promise<PriceOnDemandExtras[]> {
    const logger = this.logger.child(logContext);
    const redstoneFeeds = this.oracle.getRedstoneFeeds(activeOnly);
    const tickers = tickerInfoTokensByNetwork[this.config.network];

    const redstoneUpdates: RedstoneUpdate[] = [];
    for (const t of tokens) {
      const token = t.toLowerCase() as Address;
      const feeds = redstoneFeeds[token];
      if (feeds?.length) {
        redstoneUpdates.push(
          ...feeds.map(f => ({
            ...f,
            originalToken: token,
          })),
        );
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
          // TODO:
          // HOTFIX: sometimes ticker.dataId in sdk-gov is incorrect, prefer data from chain
          const tickerFeedId =
            this.oracle.getFeed(ticker.address)?.main?.dataFeedId ??
            ticker.dataId;

          redstoneUpdates.push({
            originalToken: token,
            token: ticker.address,
            dataFeedId: tickerFeedId,
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

    const result = await this.#getRedstonePayloadForManualUsage(
      redstoneUpdates,
      "redstone-primary-prod",
      REDSTONE_SIGNERS.signersThreshold,
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

  public toMulticallUpdates(
    ca: CreditAccountData,
    priceUpdates?: PriceUpdate[],
  ): MultiCall[] {
    return (
      priceUpdates?.map(({ token, data, reserve }) => ({
        target: ca.creditFacade,
        callData: encodeFunctionData({
          abi: iCreditFacadeV3MulticallAbi,
          functionName: "onDemandPriceUpdate",
          args: [token, reserve, data],
        }),
      })) ?? []
    );
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
    const accTokens: Address[] = [];
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

  /**
   * Gets updates from redstone for multiple accounts at once
   * Reduces duplication, so that we don't make redstone request twice if two accounts share a token
   *
   * @param accounts
   * @param activeOnly
   * @returns
   */
  public async batchLiquidationPreviewUpdates(
    accounts: CreditAccountData[],
    activeOnly = false,
  ): Promise<Record<Address, PriceUpdate[]>> {
    const tokensByAccount: Record<Address, Set<Address>> = {};
    const allTokens = new Set<Address>();
    for (const ca of accounts) {
      const accTokens = tokensByAccount[ca.addr] ?? new Set<Address>();
      for (const { token, balance, isEnabled } of ca.allBalances) {
        if (isEnabled && balance > 10n) {
          accTokens.add(token);
          allTokens.add(token);
        }
      }
      tokensByAccount[ca.addr] = accTokens;
    }

    const priceUpdates = await this.updatesForTokens(
      Array.from(allTokens),
      activeOnly,
    );

    const result: Record<Address, PriceUpdate[]> = {};
    for (const [accAddr, accTokens] of Object.entries(tokensByAccount)) {
      const accUpdates: PriceUpdate[] = [];
      // There can be 2 price feeds (main and reserve) per originalToken
      for (const u of priceUpdates) {
        if (accTokens.has(u.originalToken)) {
          accUpdates.push({
            token: u.token,
            reserve: u.reserve,
            data: u.callData,
          });
        }
      }
      result[accAddr as Address] = accUpdates;
    }

    return result;
  }

  async #getRedstonePayloadForManualUsage(
    updates: RedstoneUpdate[],
    dataServiceId: string,
    uniqueSignersCount: number,
    logContext: Record<string, any> = {},
  ): Promise<PriceOnDemandExtras[]> {
    const logger = this.logger.child(logContext);
    const cacheAllowed = this.config.optimistic;

    const networkUpdates: RedstoneUpdate[] = [];
    let networkResponses: PriceOnDemandExtras[] = [];
    const cachedResponses: PriceOnDemandExtras[] = [];

    for (const upd of updates) {
      const key = redstoneCacheKey(upd, dataServiceId, uniqueSignersCount);
      if (cacheAllowed && this.#optimisticCache.has(key)) {
        logger.debug(`using cached response for ${key}`);
        cachedResponses.push(this.#optimisticCache.get(key)!);
      } else {
        networkUpdates.push(upd);
      }
    }

    if (networkUpdates.length) {
      logger.debug(
        `fetching ${networkUpdates.length} redstone updates: ${printFeeds(networkUpdates)}`,
      );
      networkResponses = await this.#fetchRedstonePayloadForManualUsage(
        networkUpdates,
        dataServiceId,
        uniqueSignersCount,
      );
      if (cacheAllowed) {
        for (const resp of networkResponses) {
          const key = redstoneCacheKey(resp, dataServiceId, uniqueSignersCount);
          this.#optimisticCache.set(key, resp);
          logger.debug(`cached response for ${key}`);
        }
      }
    }

    this.logger.debug(
      `got ${networkResponses.length} updates from redstone and ${cachedResponses.length} from cache`,
    );

    return [...networkResponses, ...cachedResponses];
  }

  async #fetchRedstonePayloadForManualUsage(
    updates: RedstoneUpdate[],
    dataServiceId: string,
    uniqueSignersCount: number,
  ): Promise<PriceOnDemandExtras[]> {
    const wrapper = new DataServiceWrapper({
      dataServiceId,
      dataPackagesIds: Array.from(new Set(updates.map(t => t.dataFeedId))),
      uniqueSignersCount,
      historicalTimestamp: this.#optimisticTimestamp,
    });
    wrapper.setMetadataTimestamp(Date.now());
    // redstone does not provide any error types, just string messages
    // so just retry all redstone errors
    const dataPayload = await retry(
      () => wrapper.prepareRedstonePayload(true),
      { attempts: 5 },
    );

    // unsigned metadata looks like
    // "1724772413180#0.6.1#redstone-primary-prod___"
    // where 0.6.1 is @redstone-finance/evm-connector version
    // and 1724772413180 is current timestamp
    const parsed = RedstonePayload.parse(toBytes(`0x${dataPayload}`));
    const packagesByDataFeedId = groupDataPackages(parsed.signedDataPackages);

    const result: PriceOnDemandExtras[] = [];
    for (const t of updates) {
      const { dataFeedId, originalToken, reserve, token } = t;
      const signedDataPackages = packagesByDataFeedId[dataFeedId];
      if (!signedDataPackages) {
        throw new Error(`cannot find data packages for ${dataFeedId}`);
      }
      if (signedDataPackages.length !== uniqueSignersCount) {
        throw new Error(
          `got ${signedDataPackages.length} data packages for ${dataFeedId}, but expected ${uniqueSignersCount}`,
        );
      }
      const calldataWithTs = getCalldataWithTimestamp(
        signedDataPackages,
        wrapper.getUnsignedMetadata(),
      );
      result.push({
        dataFeedId,
        originalToken,
        token,
        reserve,
        ...calldataWithTs,
      });
    }

    return result;
  }
}

function redstoneCacheKey(
  update: RedstoneUpdate,
  dataServiceId: string,
  uniqueSignersCount: number,
): string {
  const { token, dataFeedId, reserve } = update;
  return [
    getTokenSymbolOrTicker(token),
    reserve ? "reserve" : "main",
    dataServiceId,
    dataFeedId,
    uniqueSignersCount,
  ].join("|");
}

function groupDataPackages(
  signedDataPackages: SignedDataPackage[],
): Record<string, SignedDataPackage[]> {
  const packagesByDataFeedId: Record<string, SignedDataPackage[]> = {};
  for (const p of signedDataPackages) {
    const { dataPoints } = p.dataPackage;

    // Check if all data points have the same dataFeedId
    const dataFeedId0 = dataPoints[0].dataFeedId;
    for (const dp of dataPoints) {
      if (dp.dataFeedId !== dataFeedId0) {
        throw new Error(
          `data package contains data points with different dataFeedIds: ${dp.dataFeedId} and ${dataFeedId0}`,
        );
      }
    }

    // Group data packages by dataFeedId
    if (!packagesByDataFeedId[dataFeedId0]) {
      packagesByDataFeedId[dataFeedId0] = [];
    }
    packagesByDataFeedId[dataFeedId0].push(p);
  }

  return packagesByDataFeedId;
}

function getCalldataWithTimestamp(
  packages: SignedDataPackage[],
  unsignedMetadata: string,
): TimestampedCalldata {
  const originalPayload = RedstonePayload.prepare(packages, unsignedMetadata);

  // Calculating the number of bytes in the hex representation of payload
  // We divide by 2, beacuse 2 symbols in a hex string represent one byte
  const originalPayloadLength = originalPayload.length / 2;

  // Number of bytes that we want to add to unsigned metadata so that
  // payload byte size becomes a multiplicity of 32
  const bytesToAdd = 32 - (originalPayloadLength % 32);

  // Adding underscores to the end of the metadata string, each underscore
  // uses one byte in UTF-8
  const newUnsignedMetadata = unsignedMetadata + "_".repeat(bytesToAdd);

  const payload = RedstonePayload.prepare(packages, newUnsignedMetadata);

  let ts = 0;
  packages.forEach(p => {
    const newTimestamp = p.dataPackage.timestampMilliseconds / 1000;
    if (ts === 0) {
      ts = newTimestamp;
    } else if (ts !== newTimestamp) {
      throw new Error("Timestamps are not equal");
    }
  });

  return {
    callData: encodeAbiParameters(parseAbiParameters("uint256, bytes"), [
      BigInt(ts),
      `0x${payload}`,
    ]),
    ts,
  };
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
