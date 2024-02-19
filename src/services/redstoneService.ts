import type {
  CreditAccountData,
  MultiCall,
  PriceFeedData,
} from "@gearbox-protocol/sdk";
import {
  ICreditFacadeV3Multicall__factory,
  priceFeedsByToken,
  PriceFeedType,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk";
import { DataServiceWrapper } from "@redstone-finance/evm-connector/dist/src/wrappers/DataServiceWrapper";
import { ethers, utils } from "ethers";
import { arrayify } from "ethers/lib/utils";
import { RedstonePayload } from "redstone-protocol";

import type { LoggerInterface } from "../log";
import type { PriceOnDemand } from "./liquidate";

const cfMulticall = ICreditFacadeV3Multicall__factory.createInterface();

export type RedstonePriceFeed = Extract<
  PriceFeedData,
  { type: PriceFeedType.REDSTONE_ORACLE }
>;

export class RedstoneService {
  log?: LoggerInterface;

  public async updateRedstone(tokens: string[]): Promise<PriceOnDemand[]> {
    const redstoneFeeds: Array<RedstonePriceFeed & { token: string }> = [];

    for (const t of tokens) {
      const token = t.toLowerCase();
      const symbol = tokenSymbolByAddress[token];
      if (!symbol) {
        this.log?.warn(
          `Failed price feed for token ${token} which is not found in SDK`,
        );
        continue;
      }

      const feed = priceFeedsByToken[symbol];
      const entry = feed?.AllNetworks ?? feed?.Mainnet;
      if (!entry) {
        this.log?.warn(
          `Cannot find price feed for token ${symbol} (${token}) in SDK`,
        );
        continue;
      }
      // it is technically possible to have both main and reserve price feeds to be redstone
      // but from practical standpoint this makes no sense: so use else-if, not if-if
      if (entry.Main?.type === PriceFeedType.REDSTONE_ORACLE) {
        redstoneFeeds.push({ token, ...entry.Main });
        this.log?.debug(
          `need to update main redstone price feed ${entry.Main.dataId} in ${entry.Main.dataServiceId} for token ${symbol} (${token})`,
        );
      } else if (entry?.Reserve?.type === PriceFeedType.REDSTONE_ORACLE) {
        redstoneFeeds.push({ token, ...entry.Reserve });
        this.log?.debug(
          `need to update reserve redstone price feed ${entry.Reserve.dataId} in ${entry.Reserve.dataServiceId} for token ${symbol} (${token})`,
        );
      } else {
        this.log?.warn(
          `non-restone price feed failed for token ${symbol} (${token}): ${JSON.stringify(
            entry,
          )}`,
        );
      }
    }

    this.log?.debug(`need to update ${redstoneFeeds.length} redstone feeds`);
    return Promise.all(
      redstoneFeeds.map(f =>
        this.#getRedstonePayloadForManualUsage(
          f.token,
          f.dataServiceId,
          f.dataId,
          f.signersThreshold,
        ),
      ),
    );
  }

  public async redstoneUpdatesForCreditAccount(
    ca: CreditAccountData,
    redstoneTokens: string[],
  ): Promise<MultiCall[]> {
    // find all tokens on CA that are enabled, have some balance and are redstone tokens
    const accRedstoneTokens: string[] = [];
    const accRedstoneSymbols: string[] = [];

    for (const t of redstoneTokens) {
      const token = t.toLowerCase();
      const { balance = 1n, isEnabled } = ca.allBalances[token] ?? {};
      if (isEnabled && balance > 1n) {
        accRedstoneTokens.push(token);
        accRedstoneSymbols.push(tokenSymbolByAddress[token]);
      }
    }
    this.log?.debug(
      `need to update ${accRedstoneSymbols.length} redstone tokens on acc ${
        ca.addr
      }: ${accRedstoneSymbols.join(", ")}`,
    );

    const priceUpdates = await this.updateRedstone(accRedstoneTokens);
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
