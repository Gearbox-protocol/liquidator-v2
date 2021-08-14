import { Inject, Service } from "typedi";
import {
  AggregatorV3Interface,
  AggregatorV3Interface__factory,
  IPriceOracle,
  IPriceOracle__factory,
} from "../types/ethers-v5";
import { BigNumber, Signer } from "ethers";
import { TokenService } from "./tokenService";
import { Logger, LoggerInterface } from "../decorators/logger";
import { formatBN, typedEventsComparator, WAD } from "@diesellabs/gearbox-sdk";

@Service()
export class OracleService {
  @Logger("OracleService")
  log: LoggerInterface;

  @Inject()
  tokenService: TokenService;

  protected _wethToken: string;
  protected _contract: IPriceOracle;
  protected _priceFeeds: Record<string, AggregatorV3Interface> = {};
  protected _prices: Record<string, BigNumber> = {};
  protected _signer: Signer;

  async launch(address: string, signer: Signer, wethToken: string) {
    this._signer = signer;
    this._wethToken = wethToken;
    this._contract = IPriceOracle__factory.connect(address, signer);
    this._prices[wethToken] = WAD;

    await this._getHistoricalData();
    this._subscribeOnPriceFeedChanges();

  }

  async updatePrices() {
    const jobs = Object.keys(this._priceFeeds).map((token) =>
      this._updatePrice(token)
    );

    await Promise.all(jobs);

    Object.entries(this._prices).forEach(([address, rate]) =>
      this.log.info(
        `[${this.tokenService.symbol(address)}/ETH]: ${formatBN(
          BigNumber.from(10).pow(36).div(rate),
          18
        )}`
      )
    );
  }

  convert(amount: BigNumber, from: string, to: string): BigNumber {
    return amount
      .mul(BigNumber.from(10).pow(18 - this.tokenService.decimals(from)))
      .mul(this.getPrice(from, to))
      .div(BigNumber.from(10).pow(36 - this.tokenService.decimals(to)));
  }

  protected async _updatePrice(token: string) {
    try {
      const roundData = await this._priceFeeds[token].latestRoundData();
      this._prices[token] = roundData.answer;
    } catch (e) {
      this.log.error(e);
    }
  }

  protected async _getHistoricalData() {
    const feed = await this._contract.queryFilter(
      this._contract.filters.NewPriceFeed()
    );

    const priceFeedAddresses: Record<string, string> = {};

    feed
      .sort(typedEventsComparator)
      .forEach(
        ({ args: { token, priceFeed } }) =>
          (priceFeedAddresses[token] = priceFeed)
      );

    const jobs = Object.entries(priceFeedAddresses).map(
      async ([token, priceFeedAddress]) =>
        await this._updatePriceFeed(token, priceFeedAddress)
    );

    await Promise.all(jobs);
  }

  protected _subscribeOnPriceFeedChanges() {
    this._contract.on(
      this._contract.filters.NewPriceFeed(),
      async (token, priceFeed) => await this._updatePriceFeed(token, priceFeed)
    );
  }

  protected async _updatePriceFeed(token: string, priceFeed: string) {
    await this.tokenService.addToken(token);

    this._priceFeeds[token] = AggregatorV3Interface__factory.connect(
      priceFeed,
      this._signer
    );

    await this._updatePrice(token);
  }

  protected getPrice(from: string, to: string): BigNumber {
    if (from === to) return WAD;

    if (!this._prices[to]) throw new Error(`Price doesn't exists ${to}`);

    if (from === this._wethToken) {
      return WAD.mul(WAD).div(this._prices[to]);
    }

    if (!this._prices[from]) throw new Error(`Price doesn't exists ${from}`);

    if (to === this._wethToken) {
      return this._prices[from];
    }

    return WAD.mul(this._prices[from]).div(this._prices[to]);
  }
}
