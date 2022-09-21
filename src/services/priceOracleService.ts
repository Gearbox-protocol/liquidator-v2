import {
  CallData,
  formatBN,
  IPriceOracleV2,
  IPriceOracleV2__factory,
  MultiCallContract,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk";
import { PriceOracleData } from "@gearbox-protocol/sdk/lib/core/priceOracle";
import { IPriceOracleV2Interface } from "@gearbox-protocol/sdk/lib/types/contracts/interfaces/IPriceOracle.sol/IPriceOracleV2";
import { BigNumberish, providers, Signer } from "ethers";
import { Inject, Service } from "typedi";

import { Logger, LoggerInterface } from "../decorators/logger";
import { AMPQService } from "./ampqService";

@Service()
export class PriceOracleService {
  @Logger("PriceOracleService")
  log: LoggerInterface;

  @Inject()
  ampqService: AMPQService;

  priceOracle: PriceOracleData;

  protected _contract: IPriceOracleV2;
  protected _tokens: Array<string>;
  protected _provider: providers.Provider;

  /**
   * Launches PriceOracleService
   * @param address Address of PriceOracle
   * @param provider Ethers provider for fetching data
   */
  async launch(address: string, provider: providers.Provider) {
    this._provider = provider;
    this._contract = IPriceOracleV2__factory.connect(address, provider);
    this.priceOracle = new PriceOracleData([]);
    const query = await this._contract.queryFilter(
      this._contract.filters.NewPriceFeed(),
    );

    this._tokens = Array.from(
      new Set(query.map(r => r.args.token.toLowerCase())),
    );

    await this.updatePrices();
    this.printPrices();
  }

  /**
   * Updates prices for all connected oracles
   */
  async updatePrices() {
    const priceFeedMulticall = new MultiCallContract(
      this._contract.address,
      IPriceOracleV2__factory.createInterface(),
      this._provider,
    );

    const calls: Array<CallData<IPriceOracleV2Interface>> = this._tokens.map(
      t => ({
        method: "getPrice(address)",
        params: [t],
      }),
    );

    try {
      const prices: Array<BigNumberish> = await priceFeedMulticall.call(calls);
      const priceUpdate = this._tokens.map((token, num) => ({
        token,
        price: prices[num],
      }));
      this.priceOracle.updatePrices(priceUpdate);
    } catch (e) {
      this.ampqService.error(`Can update price from priceOracle, ${e}`);
    }
  }

  /**
   * Prints current prices
   */
  printPrices() {
    const prices = this._tokens
      .map(
        token =>
          `[${tokenSymbolByAddress[token.toLowerCase()]}]: ${formatBN(
            this.priceOracle.getPrice(token),
            8,
          )}`,
      )
      .join("\n");

    this.log.info(prices);
  }
}
