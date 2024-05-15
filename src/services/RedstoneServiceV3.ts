import type {
  CreditAccountData,
  MultiCall,
  PriceFeedData,
  PriceFeedType,
} from "@gearbox-protocol/sdk";
import {
  getTokenSymbolOrTicker,
  ICreditFacadeV3Multicall__factory,
  REDSTONE_SIGNERS,
  tickerInfoTokensByNetwork,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk";
import { DataServiceWrapper } from "@redstone-finance/evm-connector/dist/src/wrappers/DataServiceWrapper";
import type { providers } from "ethers";
import { ethers, utils } from "ethers";
import { arrayify, hexlify } from "ethers/lib/utils";
import { RedstonePayload } from "redstone-protocol";
import { Inject, Service } from "typedi";

import config from "../config";
import { Logger, LoggerInterface } from "../log";
import { AddressProviderService } from "./AddressProviderService";
import type { PriceOnDemand } from "./liquidate";
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

  @Inject()
  oracle: OracleServiceV3;

  @Inject()
  addressProvider: AddressProviderService;

  protected provider?: providers.Provider;

  public launch(provider: providers.Provider): void {
    this.provider = provider;
  }

  public async updatesForTokens(tokens: string[]): Promise<PriceOnDemand[]> {
    const redstoneFeeds = this.oracle.getRedstoneFeeds();
    const redstoneUpdates: Array<[token: string, dataFeedId: string]> = [];
    const tickers = tickerInfoTokensByNetwork[this.addressProvider.network];
    for (const token of tokens) {
      const dataFeedId = redstoneFeeds[token.toLowerCase()];
      if (dataFeedId) {
        redstoneUpdates.push([token, dataFeedId]);
        continue;
      }
      const symb = tokenSymbolByAddress[token.toLowerCase()];
      const ticker = tickers[symb];
      if (ticker) {
        if (this.oracle.hasFeed(ticker.address)) {
          this.log.debug(
            `will update redstone ticker ${ticker.symbol} for ${symb}`,
          );
          redstoneUpdates.push([ticker.address, ticker.dataId]);
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
      redstoneUpdates.map(([token, dataFeedId]) =>
        this.#getRedstonePayloadForManualUsage(
          token,
          "redstone-primary-prod",
          dataFeedId,
          REDSTONE_SIGNERS.signersThreshold,
        ),
      ),
    );

    if (config.optimisticLiquidations && result.length > 0) {
      const redstoneTs = minTimestamp(result);
      let block = await this.provider!.getBlock("latest");
      const delta = block.timestamp - redstoneTs;
      if (delta < 0) {
        this.log?.debug(
          `warp, because block ts ${block.timestamp} < ${redstoneTs} redstone ts (${Math.ceil(-delta / 60)} min)`,
        );
        await (this.provider as any).send("evm_mine", [hexlify(redstoneTs)]);
        // await (this.provider as any).send("anvil_setNextBlockTimestamp", [
        // hexlify(redstoneTs),
        // ]);
        block = await this.provider!.getBlock("latest");
        this.log?.debug(`new block ts: ${block.timestamp}`);
      }
    }

    return result;
  }

  public async updatesForAccount(ca: CreditAccountData): Promise<MultiCall[]> {
    const accTokens: string[] = [];
    for (const [token, { balance, isEnabled }] of Object.entries(
      ca.allBalances,
    )) {
      if (isEnabled && balance > 10n) {
        accTokens.push(token);
      }
    }
    const priceUpdates = await this.updatesForTokens(accTokens);
    return priceUpdates.map(({ token, callData }) => ({
      target: ca.creditFacade,
      callData: cfMulticall.encodeFunctionData("onDemandPriceUpdate", [
        token,
        false, // reserve
        callData,
      ]),
    }));
  }

  async #getRedstonePayloadForManualUsage(
    token: string,
    dataServiceId: string,
    dataFeeds: string,
    uniqueSignersCount: number,
  ): Promise<PriceOnDemand> {
    const dataPayload = await new DataServiceWrapper({
      dataServiceId,
      dataFeeds: [dataFeeds],
      uniqueSignersCount,
    }).prepareRedstonePayload(true);

    const { signedDataPackages, unsignedMetadata } = RedstonePayload.parse(
      arrayify(`0x${dataPayload}`),
    );

    const dataPackagesList = splitResponse(
      signedDataPackages,
      uniqueSignersCount,
    );

    const result = dataPackagesList.map(list => {
      const payload = new RedstonePayload(
        list,
        utils.toUtf8String(unsignedMetadata),
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
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "bytes"],
          [ts, arrayify(`0x${payload.toBytesHexWithout0xPrefix()}`)],
        ),
        ts,
      ] as const;
    });

    return { token, callData: result[0][0], ts: result[0][1] };
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

function printFeeds(feeds: Array<[token: string, dataFeedId: string]>): string {
  return feeds
    .map(
      ([token, dataFeedId]) =>
        `${getTokenSymbolOrTicker(token as any)} -> ${dataFeedId}`,
    )
    .join(", ");
}

function minTimestamp(updates: PriceOnDemand[]): number {
  let result = Number.POSITIVE_INFINITY;
  for (const { ts } of updates) {
    result = Math.min(result, ts);
  }
  return result;
}
