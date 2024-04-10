import type { IDataCompressorV3 } from "@gearbox-protocol/sdk";
import { IDataCompressorV3__factory, PathFinder } from "@gearbox-protocol/sdk";
import { Inject } from "typedi";

import type { LoggerInterface } from "../../log";
import { AddressProviderService } from "../AddressProviderService";
import ExecutorService from "../ExecutorService";
import OracleServiceV3 from "../OracleServiceV3";
import { RedstoneServiceV3 } from "../RedstoneServiceV3";

export default abstract class AbstractLiquidationStrategyV3 {
  logger: LoggerInterface;

  @Inject()
  addressProvider: AddressProviderService;

  @Inject()
  redstone: RedstoneServiceV3;

  @Inject()
  oracle: OracleServiceV3;

  @Inject()
  executor: ExecutorService;

  #compressor?: IDataCompressorV3;
  #pathFinder?: PathFinder;

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
