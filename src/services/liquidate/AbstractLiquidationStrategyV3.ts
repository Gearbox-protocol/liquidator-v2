import type { IDataCompressorV3 } from "@gearbox-protocol/sdk";
import { IDataCompressorV3__factory, PathFinder } from "@gearbox-protocol/sdk";

import type { LoggerInterface } from "../../log";
import type { AddressProviderService } from "../AddressProviderService";
import type { KeyService } from "../keyService";
import type { RedstoneServiceV3 } from "../RedstoneServiceV3";
import type { StrategyOptions } from "./types";

export default abstract class AbstractLiquidationStrategyV3 {
  #logger?: LoggerInterface;
  #compressor?: IDataCompressorV3;
  #pathFinder?: PathFinder;
  #addressProvider?: AddressProviderService;
  #redstone?: RedstoneServiceV3;
  #keyService?: KeyService;

  public async launch(options: StrategyOptions): Promise<void> {
    this.#logger = options.logger;
    this.#addressProvider = options.addressProvider;
    this.#redstone = options.redstone;
    const [pfAddr, dcAddr] = await Promise.all([
      this.#addressProvider.findService("ROUTER", 300),
      this.#addressProvider.findService("DATA_COMPRESSOR", 300),
    ]);
    this.#compressor = IDataCompressorV3__factory.connect(
      dcAddr,
      options.provider,
    );
    this.#pathFinder = new PathFinder(
      pfAddr,
      options.provider,
      options.addressProvider.network,
    );
    // TODO: remove me
    this.#keyService = options.keyService;
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

  protected get addressProvider(): AddressProviderService {
    if (!this.#addressProvider) {
      throw new Error("strategy not launched");
    }
    return this.#addressProvider;
  }

  protected get redstone(): RedstoneServiceV3 {
    if (!this.#redstone) {
      throw new Error("strategy not launched");
    }
    return this.#redstone;
  }

  protected get logger(): LoggerInterface {
    if (!this.#logger) {
      throw new Error("strategy not launched");
    }
    return this.#logger;
  }

  protected get keyService(): KeyService {
    if (!this.#keyService) {
      throw new Error("strategy not launched");
    }
    return this.#keyService;
  }
}
