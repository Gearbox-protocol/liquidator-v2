import type { IDataCompressorV3_00 } from "@gearbox-protocol/sdk";
import {
  CreditAccountData,
  IAddressProviderV3__factory,
  IDataCompressorV3_00__factory,
} from "@gearbox-protocol/sdk";
import { ethers, type providers } from "ethers";
import { Inject, Service } from "typedi";

import config from "../../config";
import { Logger, LoggerInterface } from "../../log";
import type { ILiquidatorService } from "../liquidate";
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
    const accountsRaw =
      await this.dataCompressor.callStatic.getLiquidatableCreditAccounts([], {
        blockTag: atBlock,
      });
    const accounts = accountsRaw.map(a => new CreditAccountData(a));
    this.log.debug(
      `v3 accounts to liquidate in ${atBlock}: ${accounts.length}`,
    );
    if (config.optimisticLiquidations) {
      await this.liquidateOptimistically(accounts);
    } else {
      await this.liquidateNormal(accounts);
    }
  }
}
