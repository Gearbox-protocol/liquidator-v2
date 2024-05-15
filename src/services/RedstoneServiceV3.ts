import {
  getTokenSymbolOrTicker,
  type PriceFeedData,
  type PriceFeedType,
  REDSTONE_SIGNERS,
  tickerInfoTokensByNetwork,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk-gov";
import type { MultiCall } from "@gearbox-protocol/types/v3";
import { ICreditFacadeV3Multicall__factory } from "@gearbox-protocol/types/v3";
import { DataServiceWrapper } from "@redstone-finance/evm-connector";
import { AbiCoder, getBytes, Provider, toBeHex, toUtf8String } from "ethers";
import { RedstonePayload } from "redstone-protocol";
import { Inject, Service } from "typedi";

import { CONFIG, type ConfigSchema } from "../config";
import { Logger, type LoggerInterface } from "../log";
import { formatTs, PROVIDER } from "../utils";
import type { CreditAccountData } from "../utils/ethers-6-temp";
import { AddressProviderService } from "./AddressProviderService";
import type { PriceOnDemandExtras, PriceUpdate } from "./liquidate/types";
import type { RedstoneFeed } from "./OracleServiceV3";
import OracleServiceV3 from "./OracleServiceV3";

const cfMulticall = ICreditFacadeV3Multicall__factory.createInterface();

export type RedstonePriceFeed = Extract<
  PriceFeedData,
  { type: PriceFeedType.REDSTONE_ORACLE }
>;

@Service()
export class RedstoneServiceV3 {
  @Logger("RedstoneServiceV3")
  log: LoggerInterface;

  @Inject(CONFIG)
  config: ConfigSchema;

  @Inject()
  oracle: OracleServiceV3;

  @Inject()
  addressProvider: AddressProviderService;

  @Inject(PROVIDER)
  provider: Provider;

  public launch(): void {
    this.liquidationPreviewUpdates = this.liquidationPreviewUpdates.bind(this);
  }

  public async updatesForTokens(
    tokens: string[],
    activeOnly: boolean,
  ): Promise<PriceOnDemandExtras[]> {
    const redstoneFeeds = this.oracle.getRedstoneFeeds(activeOnly);
    const tickers = tickerInfoTokensByNetwork[this.addressProvider.network];

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
      let block = await this.provider.getBlock("latest");
      if (!block) {
        throw new Error("cannot get latest block");
      }
      const delta = block.timestamp - redstoneTs;
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
        await (this.provider as any).send("evm_mine", [toBeHex(redstoneTs)]);
        // await (this.provider as any).send("anvil_setNextBlockTimestamp", [
        // toBeHex(redstoneTs),
        // ]);
        block = await this.provider.getBlock("latest");
        this.log?.debug({ tag: "timing" }, `new block ts: ${formatTs(block)}`);
      }
    }

    return result;
  }

  public async compressorUpdates(ca: CreditAccountData): Promise<MultiCall[]> {
    const priceUpdates = await this.liquidationPreviewUpdates(ca, true);
    return priceUpdates.map(({ token, data, reserve }) => ({
      target: ca.creditFacade,
      callData: cfMulticall.encodeFunctionData("onDemandPriceUpdate", [
        token,
        reserve,
        data,
      ]),
    }));
  }

  public async liquidationPreviewUpdates(
    ca: CreditAccountData,
    activeOnly = false,
  ): Promise<PriceUpdate[]> {
    const accTokens: string[] = [];
    for (const [token, { balance, isEnabled }] of Object.entries(
      ca.allBalances,
    )) {
      if (isEnabled && balance > 10n) {
        accTokens.push(token);
      }
    }
    const priceUpdates = await this.updatesForTokens(accTokens, activeOnly);
    return priceUpdates.map(({ token, reserve, callData }) => ({
      token,
      reserve,
      data: callData,
    }));
  }

  async #getRedstonePayloadForManualUsage(
    token: string,
    reserve: boolean,
    dataServiceId: string,
    dataFeedId: string,
    uniqueSignersCount: number,
  ): Promise<PriceOnDemandExtras> {
    const dataPayload = await new DataServiceWrapper({
      dataServiceId,
      dataFeeds: [dataFeedId],
      uniqueSignersCount,
    }).prepareRedstonePayload(true);

    const { signedDataPackages, unsignedMetadata } = RedstonePayload.parse(
      getBytes(`0x${dataPayload}`),
    );

    const dataPackagesList = splitResponse(
      signedDataPackages,
      uniqueSignersCount,
    );

    const result = dataPackagesList.map(list => {
      const payload = new RedstonePayload(list, toUtf8String(unsignedMetadata));

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
        AbiCoder.defaultAbiCoder().encode(
          ["uint256", "bytes"],
          [ts, getBytes(`0x${payload.toBytesHexWithout0xPrefix()}`)],
        ),
        ts,
      ] as const;
    });

    return { token, reserve, callData: result[0][0], ts: result[0][1] };
  }
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
        `${getTokenSymbolOrTicker(f.token as any)} ${f.reserve ? "reserve" : "main"} -> ${f.dataFeedId}`,
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
