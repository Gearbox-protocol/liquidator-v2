import type {
  CreditAccountData,
  MultiCall,
  PriceFeedData,
  PriceFeedType,
} from "@gearbox-protocol/sdk";
import {
  ICreditFacadeV3Multicall__factory,
  REDSTONE_SIGNERS,
} from "@gearbox-protocol/sdk";
import { DataServiceWrapper } from "@redstone-finance/evm-connector/dist/src/wrappers/DataServiceWrapper";
import type { providers } from "ethers";
import { ethers, utils } from "ethers";
import { arrayify, hexlify } from "ethers/lib/utils";
import { RedstonePayload } from "redstone-protocol";
import { Inject, Service } from "typedi";

import config from "../config";
import { Logger, LoggerInterface } from "../log";
import type { PriceOnDemandExtras, PriceUpdate } from "./liquidate/types";
import OracleServiceV3 from "./OracleServiceV3";

const cfMulticall = ICreditFacadeV3Multicall__factory.createInterface();

export type RedstonePriceFeed = Extract<
  PriceFeedData,
  { type: PriceFeedType.REDSTONE_ORACLE }
>;

@Service()
export class RedstoneServiceV3 {
  @Logger("AddressProviderService")
  log: LoggerInterface;

  @Inject()
  oracle: OracleServiceV3;

  protected provider?: providers.Provider;

  public launch(provider: providers.Provider): void {
    this.provider = provider;
  }

  public async updatesForTokens(
    tokens: string[],
    activeOnly: boolean,
  ): Promise<PriceOnDemandExtras[]> {
    const tokenz = tokens.map(t => t.toLowerCase());
    const redstoneFeeds = this.oracle
      .getRedstoneFeeds(activeOnly)
      .filter(f => tokenz.includes(f.token));

    this.log?.debug(
      `need to update ${redstoneFeeds.length} redstone feeds: ${redstoneFeeds.map(({ dataFeedId }) => dataFeedId).join(", ")}`,
    );
    const result = await Promise.all(
      redstoneFeeds.map(({ token, dataFeedId, reserve }) =>
        this.#getRedstonePayloadForManualUsage(
          token,
          reserve,
          "redstone-primary-prod",
          dataFeedId,
          REDSTONE_SIGNERS.signersThreshold,
        ),
      ),
    );

    if (config.optimistic && result.length > 0) {
      const redstoneTs = result[0].ts;
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
