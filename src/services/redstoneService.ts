import type { PriceFeedData } from "@gearbox-protocol/sdk";
import {
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

export type RedstonePriceFeed = Extract<
  PriceFeedData,
  { type: PriceFeedType.REDSTONE_ORACLE }
>;

export class RedstoneService {
  log: LoggerInterface;

  protected async updateRedstone(tokens: string[]): Promise<PriceOnDemand[]> {
    const redstoneFeeds: Array<RedstonePriceFeed & { token: string }> = [];

    for (const t of tokens) {
      const token = t.toLowerCase();
      const symbol = tokenSymbolByAddress[token];
      if (!symbol) {
        this.log.warn(
          `Failed price feed for token ${token} which is not found in SDK`,
        );
        continue;
      }

      const feed = priceFeedsByToken[symbol];
      const entry = feed?.AllNetworks ?? feed?.Mainnet;
      if (!entry) {
        this.log.warn(
          `Cannot find price feed for token ${symbol} (${token}) in SDK`,
        );
        continue;
      }

      // it is technically possible to have both main and reserve price feeds to be redstone
      // but from practical standpoint this makes no sense: so use else-if, not if-if
      if (entry.Main?.type === PriceFeedType.REDSTONE_ORACLE) {
        redstoneFeeds.push({ token, ...entry.Main });
        this.log.debug(
          `need to update main redstone price feed ${entry.Main.dataId} in ${entry.Main.dataServiceId} for token ${symbol} (${token})`,
        );
      } else if (entry?.Reserve?.type === PriceFeedType.REDSTONE_ORACLE) {
        redstoneFeeds.push({ token, ...entry.Reserve });
        this.log.debug(
          `need to update reserve redstone price feed ${entry.Reserve.dataId} in ${entry.Reserve.dataServiceId} for token ${symbol} (${token})`,
        );
      } else {
        this.log.warn(
          `non-restone price feed failed for token ${symbol} (${token}): ${JSON.stringify(
            entry,
          )}`,
        );
      }
    }

    this.log.debug(`need to update ${redstoneFeeds.length} redstone feeds`);
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

      return ethers.utils.defaultAbiCoder.encode(
        ["uint256", "bytes"],
        [ts, arrayify(`0x${payload.toBytesHexWithout0xPrefix()}`)],
      );
    });

    return { token, callData: result[0] };
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
