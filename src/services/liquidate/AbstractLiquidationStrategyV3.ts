import type { IDataCompressorV3 } from "@gearbox-protocol/sdk";
import {
  CreditAccountData,
  CreditManagerData,
  IDataCompressorV3__factory,
  PathFinder,
} from "@gearbox-protocol/sdk";
import { Inject } from "typedi";

import { CONFIG, ConfigSchema } from "../../config";
import type { LoggerInterface } from "../../log";
import { AddressProviderService } from "../AddressProviderService";
import ExecutorService from "../ExecutorService";
import OracleServiceV3 from "../OracleServiceV3";
import { RedstoneServiceV3 } from "../RedstoneServiceV3";

export default abstract class AbstractLiquidationStrategyV3 {
  logger: LoggerInterface;

  @Inject()
  addressProvider: AddressProviderService;

  @Inject(CONFIG)
  config: ConfigSchema;

  @Inject()
  redstone: RedstoneServiceV3;

  @Inject()
  oracle: OracleServiceV3;

  @Inject()
  executor: ExecutorService;

  #compressor?: IDataCompressorV3;
  #pathFinder?: PathFinder;
  #cmCache: Record<string, CreditManagerData> = {};

  public async launch(): Promise<void> {
    const [pfAddr, dcAddr] = await Promise.all([
      this.addressProvider.findService("ROUTER", 300),
      this.addressProvider.findService("DATA_COMPRESSOR", 300),
    ]);
    this.#compressor = IDataCompressorV3__factory.connect(
      dcAddr,
      this.executor.provider,
    );
    this.#pathFinder = new PathFinder(
      pfAddr,
      this.executor.provider,
      this.addressProvider.network,
    );
  }

  public async updateCreditAccountData(
    ca: CreditAccountData,
  ): Promise<CreditAccountData> {
    const newCa = await this.compressor.callStatic.getCreditAccountData(
      ca.addr,
      [],
    );
    return new CreditAccountData(newCa);
  }

  protected async getCreditManagerData(
    addr: string,
  ): Promise<CreditManagerData> {
    let cm: CreditManagerData | undefined;
    if (this.config.optimistic) {
      cm = this.#cmCache[addr.toLowerCase()];
    }
    if (!cm) {
      cm = new CreditManagerData(
        await this.compressor.getCreditManagerData(addr),
      );
      if (this.config.optimistic) {
        this.#cmCache[addr.toLowerCase()] = cm;
      }
    }
    return cm;
  }

  protected get compressor(): IDataCompressorV3 {
    if (!this.#compressor) {
      throw new Error("strategy not launched");
    }
    return this.#compressor;
  }

  protected get pathFinder(): PathFinder {
    if (!this.#pathFinder) {
      throw new Error("strategy not launched");
    }
    return this.#pathFinder;
  }
}
