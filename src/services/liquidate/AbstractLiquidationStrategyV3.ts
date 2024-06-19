import { iDataCompressorV3Abi } from "@gearbox-protocol/types/abi";
import type { Address } from "viem";
import { getContract } from "viem";

import type { Config } from "../../config/index.js";
import { CreditAccountData, CreditManagerData } from "../../data/index.js";
import { DI } from "../../di.js";
import type { ILogger } from "../../log/index.js";
import { PathFinder } from "../../utils/ethers-6-temp/pathfinder/index.js";
import { TxParserHelper } from "../../utils/ethers-6-temp/txparser/index.js";
import type { IDataCompressorContract } from "../../utils/index.js";
import type { AddressProviderService } from "../AddressProviderService.js";
import type Client from "../Client.js";
import type OracleServiceV3 from "../OracleServiceV3.js";
import type { RedstoneServiceV3 } from "../RedstoneServiceV3.js";

export default abstract class AbstractLiquidationStrategyV3 {
  abstract logger: ILogger;

  @DI.Inject(DI.AddressProvider)
  addressProvider!: AddressProviderService;

  @DI.Inject(DI.Config)
  config!: Config;

  @DI.Inject(DI.Redstone)
  redstone!: RedstoneServiceV3;

  @DI.Inject(DI.Oracle)
  oracle!: OracleServiceV3;

  @DI.Inject(DI.Client)
  client!: Client;

  #compressor?: IDataCompressorContract;
  #pathFinder?: PathFinder;
  #cmCache: Record<string, CreditManagerData> = {};

  public async launch(): Promise<void> {
    const [pfAddr, dcAddr] = await Promise.all([
      this.addressProvider.findService("ROUTER", 300),
      this.addressProvider.findService("DATA_COMPRESSOR", 300),
    ]);
    this.#compressor = getContract({
      abi: iDataCompressorV3Abi,
      address: dcAddr,
      client: this.client.pub,
    });
    this.#pathFinder = new PathFinder(
      pfAddr,
      this.client.pub,
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
    const { result } = await this.compressor.simulate.getCreditAccountData([
      ca.addr,
      priceUpdates,
    ]);
    return new CreditAccountData(result);
  }

  protected async getCreditManagerData(
    addr: Address,
  ): Promise<CreditManagerData> {
    let cm: CreditManagerData | undefined;
    if (this.config.optimistic) {
      cm = this.#cmCache[addr.toLowerCase()];
    }
    if (!cm) {
      cm = new CreditManagerData(
        await this.compressor.read.getCreditManagerData([addr]),
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
    const raw = await this.compressor.read.getCreditManagersV3List();
    const result = raw.map(d => new CreditManagerData(d));

    if (this.config.optimistic) {
      for (const cm of result) {
        this.#cmCache[cm.address.toLowerCase()] = cm;
      }
    }

    return result;
  }

  protected get compressor(): IDataCompressorContract {
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
