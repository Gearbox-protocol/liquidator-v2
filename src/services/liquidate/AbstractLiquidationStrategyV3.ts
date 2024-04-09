import type { IDataCompressorV3 } from "@gearbox-protocol/sdk";
import { IDataCompressorV3__factory, PathFinder } from "@gearbox-protocol/sdk";
import type { providers } from "ethers";

import type { LoggerInterface } from "../../log";
import type { AddressProviderService } from "../AddressProviderService";
import type { KeyService } from "../keyService";
import type OracleServiceV3 from "../OracleServiceV3";
import type { RedstoneServiceV3 } from "../RedstoneServiceV3";

export default abstract class AbstractLiquidationStrategyV3 {
  protected logger: LoggerInterface;
  protected addressProvider: AddressProviderService;
  protected redstone: RedstoneServiceV3;
  protected keyService: KeyService;
  protected oracle: OracleServiceV3;

  #compressor?: IDataCompressorV3;
  #pathFinder?: PathFinder;

  public async launch(provider: providers.Provider): Promise<void> {
    const [pfAddr, dcAddr] = await Promise.all([
      this.addressProvider.findService("ROUTER", 300),
      this.addressProvider.findService("DATA_COMPRESSOR", 300),
    ]);
    this.#compressor = IDataCompressorV3__factory.connect(dcAddr, provider);
    this.#pathFinder = new PathFinder(
      pfAddr,
      provider,
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
