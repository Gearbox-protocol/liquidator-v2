import type {
  IDataCompressorV3_00,
  PriceFeedData,
} from "@gearbox-protocol/sdk";
import {
  CreditAccountData,
  IAddressProviderV3__factory,
  IDataCompressorV3_00__factory,
  priceFeedsByToken,
  PriceFeedType,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk";
import type { PriceOnDemandStruct } from "@gearbox-protocol/sdk/lib/types/IDataCompressorV3_00";
import { DataServiceWrapper } from "@redstone-finance/evm-connector/dist/src/wrappers/DataServiceWrapper";
import type { providers } from "ethers";
import { ethers, utils } from "ethers";
import { arrayify } from "ethers/lib/utils";
import { RedstonePayload } from "redstone-protocol";
import { Inject, Service } from "typedi";

import config from "../../config";
import { Logger, LoggerInterface } from "../../log";
import type { ILiquidatorService } from "../liquidate";
import { LiquidatorServiceV3 } from "../liquidate";
import AbstractScanService from "./AbstractScanService";

type RedstonePriceFeed = Extract<
  PriceFeedData,
  { type: PriceFeedType.REDSTONE_ORACLE }
>;

@Service()
export class ScanServiceV3 extends AbstractScanService {
  @Logger("ScanServiceV3")
  log: LoggerInterface;

  @Inject()
  liquidarorServiceV3: LiquidatorServiceV3;

  protected dataCompressor: IDataCompressorV3_00;

  protected override get liquidatorService(): ILiquidatorService {
    return this.liquidarorServiceV3;
  }

  protected override async _launch(
    provider: providers.Provider,
  ): Promise<void> {
    const addressProvider = IAddressProviderV3__factory.connect(
      config.addressProvider,
      provider,
    );

    const dcAddr = await addressProvider.getAddressOrRevert(
      ethers.utils.formatBytes32String("DATA_COMPRESSOR"),
      300,
    );
    this.dataCompressor = IDataCompressorV3_00__factory.connect(
      dcAddr,
      provider,
    );

    const startingBlock = await provider.getBlockNumber();
    await this.updateAccounts(startingBlock);
  }

  protected override async onBlock(blockNumber: number): Promise<void> {
    await this.updateAccounts(blockNumber);
  }

  /**
   * Loads new data and recompute all health factors
   * @param atBlock Fiex block for archive node which is needed to get data
   */
  protected async updateAccounts(atBlock: number): Promise<void> {
    let [accounts, failedTokens] = await this.#potentialLiquidations(atBlock);
    this.log.debug(
      `v3 potential accounts to liquidate in ${atBlock}: ${accounts.length}, failed tokens: ${failedTokens.length}`,
    );
    const redstoneUpdates = await this.#updateRedstone(failedTokens);
    this.log.debug(`got ${redstoneUpdates} redstone price updates`);
    [accounts, failedTokens] = await this.#potentialLiquidations(
      atBlock,
      redstoneUpdates,
    );
    this.log.debug(
      `v3 accounts to liquidate in ${atBlock}: ${accounts.length}`,
    );
    // TODO: what to do when non-redstone price fails?
    if (failedTokens.length > 0) {
      this.log.error(`failed tokens: ${failedTokens.join(", ")}`);
    }

    if (config.optimisticLiquidations) {
      await this.liquidateOptimistically(accounts, redstoneUpdates);
    } else {
      await this.liquidateNormal(accounts, redstoneUpdates);
    }
  }

  /**
   * Finds all potentially liquidatable credit accounts
   *
   * Returns
   * @param atBlock
   * @returns
   */
  async #potentialLiquidations(
    atBlock: number,
    priceUpdates: PriceOnDemandStruct[] = [],
  ): Promise<[accounts: CreditAccountData[], failedTokens: string[]]> {
    const accountsRaw =
      await this.dataCompressor.callStatic.getLiquidatableCreditAccounts([], {
        blockTag: atBlock,
      });
    let accounts = accountsRaw.map(a => new CreditAccountData(a));

    // in optimistic mode, we can limit liquidations to all CM with provided underlying symbol
    if (config.underlying) {
      accounts = accounts.filter(a => {
        const underlying = tokenSymbolByAddress[a.underlyingToken];
        return config.underlying?.toLowerCase() === underlying?.toLowerCase();
      });
    }

    const failedTokens = new Set<string>();
    for (const acc of accounts) {
      acc.priceFeedsNeeded.forEach(t => failedTokens.add(t));
    }

    return [accounts, Array.from(failedTokens)];
  }

  async #updateRedstone(
    failedTokens: string[],
  ): Promise<PriceOnDemandStruct[]> {
    const redstoneFeeds: Array<RedstonePriceFeed & { token: string }> = [];

    for (const t of failedTokens) {
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

      // TODO: is it possible to have both main and reserve as redstone?
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
  ): Promise<PriceOnDemandStruct> {
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
