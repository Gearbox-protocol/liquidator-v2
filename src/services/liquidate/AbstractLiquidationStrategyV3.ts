import {
  type IDataCompressorV3,
  IDataCompressorV3__factory,
} from "@gearbox-protocol/types/v3";
import { Inject } from "typedi";

import { CONFIG, type Config } from "../../config/index.js";
import type { LoggerInterface } from "../../log/index.js";
import {
  CreditAccountData,
  CreditManagerData,
} from "../../utils/ethers-6-temp/index.js";
import { PathFinder } from "../../utils/ethers-6-temp/pathfinder/index.js";
import { TxParserHelper } from "../../utils/ethers-6-temp/txparser/index.js";
import { AddressProviderService } from "../AddressProviderService.js";
import ExecutorService from "../ExecutorService.js";
import OracleServiceV3 from "../OracleServiceV3.js";
import { RedstoneServiceV3 } from "../RedstoneServiceV3.js";

export default abstract class AbstractLiquidationStrategyV3 {
  logger: LoggerInterface;

  @Inject()
  addressProvider: AddressProviderService;

  @Inject(CONFIG)
  config: Config;

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
      this.config.network,
    );
  }

  public async updateCreditAccountData(
    ca: CreditAccountData,
  ): Promise<CreditAccountData> {
    if (!this.config.optimistic) {
      throw new Error(
        "updateCreditAccountData should only be used in optimistic mode",
      );
    }
    const priceUpdates = await this.redstone.dataCompressorUpdates(ca);
    const newCa = await this.compressor.getCreditAccountData.staticCall(
      ca.addr,
      priceUpdates,
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
    // TODO: TxParser is really old and weird class, until we refactor it it's the best place to have this
    TxParserHelper.addCreditManager(cm);
    return cm;
  }

  protected async getCreditManagersV3List(): Promise<CreditManagerData[]> {
    const raw = await this.compressor.getCreditManagersV3List();
    const result = raw.map(d => new CreditManagerData(d));

    if (this.config.optimistic) {
      for (const cm of result) {
        this.#cmCache[cm.address.toLowerCase()] = cm;
      }
    }

    return result;
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
