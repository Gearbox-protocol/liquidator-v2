import type { IDataCompressorV3_00 } from "@gearbox-protocol/sdk";
import {
  CreditAccountData,
  IAddressProviderV3__factory,
  IDataCompressorV3_00__factory,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk";
import type { providers } from "ethers";
import { ethers } from "ethers";
import { Inject, Service } from "typedi";

import config from "../../config";
import { Logger, LoggerInterface } from "../../log";
import type { ILiquidatorService, PriceOnDemand } from "../liquidate";
import { LiquidatorServiceV3 } from "../liquidate";
import AbstractScanService from "./AbstractScanService";

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
    const redstoneUpdates = await this.updateRedstone(failedTokens);
    [accounts, failedTokens] = await this.#potentialLiquidations(
      atBlock,
      redstoneUpdates,
    );
    this.log.debug(
      `v3 accounts to liquidate in ${atBlock}: ${accounts.length}`,
    );
    const redstoneTokens = redstoneUpdates.map(({ token }) => token);
    const redstoneSymbols = redstoneTokens.map(
      t => tokenSymbolByAddress[t.toLowerCase()],
    );
    this.log.debug(
      `got ${redstoneUpdates} redstone price updates: ${redstoneSymbols.join(
        ", ",
      )}`,
    );
    // TODO: what to do when non-redstone price fails?
    if (failedTokens.length > 0) {
      this.log.error(
        `failed tokens on second iteration: ${failedTokens.join(", ")}`,
      );
    }

    if (config.optimisticLiquidations) {
      await this.liquidateOptimistically(accounts, redstoneTokens);
    } else {
      await this.liquidateNormal(accounts, redstoneTokens);
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
    priceUpdates: PriceOnDemand[] = [],
  ): Promise<[accounts: CreditAccountData[], failedTokens: string[]]> {
    const accountsRaw =
      await this.dataCompressor.callStatic.getLiquidatableCreditAccounts(
        priceUpdates,
        {
          blockTag: atBlock,
        },
      );
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
}
