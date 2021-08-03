import { BigNumber } from "ethers";
import { WETH_TOKEN } from "../config";
import { formatBN, rateToNumber } from "../utils/formatter";
import { WAD } from "./constants";
import { sqrt } from "../utils/math";
import { AggregatorV3Interface } from "../types/ethers-v5";
import { ChainlinkOracleResult } from "./chainlinkOracle";
import { PairPayload } from "../payloads/pairs";

export class Pair {
  public readonly token0: string;
  public readonly token1: string;

  public readonly decimals0: number;
  public readonly decimals1: number;

  public readonly tokenDecimals: number;

  protected _reserve0: BigNumber;
  protected _reserve1: BigNumber;
  protected _reserve1CL: BigNumber;

  private _rate: number;
  private _rateCL: number;
  private _ratio: number;

  protected _rateBN: BigNumber;
  protected _rateCLBN: BigNumber;

  protected _lastUpdate: number;
  protected _priceFeed: AggregatorV3Interface | undefined;
  private _chainLinkLastUpdate: number;

  constructor(
    token: string,
    decimals: number,
    priceFeed: AggregatorV3Interface | undefined
  ) {
    [this.token0, this.token1] =
      token.toLowerCase() < WETH_TOKEN.toLowerCase()
        ? [token, WETH_TOKEN]
        : [WETH_TOKEN, token];

    [this.decimals0, this.decimals1] =
      token.toLowerCase() < WETH_TOKEN.toLowerCase()
        ? [decimals, 18]
        : [18, decimals];

    this.tokenDecimals = decimals;
    this._priceFeed = priceFeed;
  }

  updateRate(reserve0: BigNumber, reserve1: BigNumber, reserve1CL: BigNumber) {
    this._reserve0 = reserve0;
    this._reserve1 = reserve1;
    this._reserve1CL = reserve1CL;

    this._rateBN =
      this.token0 === WETH_TOKEN
        ? WAD.mul(reserve1).div(reserve0)
        : WAD.mul(reserve0).div(reserve1);
    this._rateCLBN =
      this.token0 === WETH_TOKEN
        ? WAD.mul(reserve1CL).div(reserve0)
        : WAD.mul(reserve0).div(reserve1CL);

    this._rate = rateToNumber(this._rateBN, this.tokenDecimals);
    this._rateCL = rateToNumber(this._rateCLBN, this.tokenDecimals);

    this._ratio = this._reserve1.mul(100).div(this._reserve1CL).toNumber();
  }

  computeDr(): [BigNumber, string] {
    const dr = this._reserve1.gt(this._reserve1CL)
      ? sqrt(
          this._reserve0
            .mul(this._reserve0)
            .mul(this._reserve1)
            .div(this._reserve1CL)
        ).sub(this._reserve0)
      : sqrt(this._reserve1.mul(this._reserve1CL)).sub(this._reserve1);

    const tokenNeeded = this._reserve1.gt(this._reserve1CL)
      ? this.token0
      : this.token1;
    return [dr, tokenNeeded];
  }

  async updateLastUpdate() {
    this._lastUpdate = Math.floor(Date.now() / 1000);
    await this.updateChainlinkLastUpdate();
  }

  async updateChainlinkLastUpdate() {
    if (this._priceFeed) {
      const result: ChainlinkOracleResult =
        await this._priceFeed.latestRoundData();
      this._chainLinkLastUpdate = result.updatedAt.toNumber();
    }
  }

  print() {
    console.log(
      "R0",
      formatBN(this._reserve0, this.decimals0),
      "R1",
      formatBN(this._reserve1, this.decimals1),
      "RCL",
      formatBN(this._reserve1CL, this.decimals1),
      " diff: ",
      this._ratio,
      " rate: ",
      this._rate
      // " Last update:",
      // moment(result.updatedAt.toNumber() * 1000)
    );
  }

  get rate(): number {
    return this._rate;
  }

  get rateCL(): number {
    return this._rateCL;
  }

  get ratio(): number {
    return this._ratio;
  }

  get lastUpdate(): number {
    return this._lastUpdate;
  }

  get chainLinkLastUpdate(): number {
    return this._chainLinkLastUpdate;
  }

  getPayload(): PairPayload {
    return {
      lastUpdate: this._lastUpdate,
      rate: this._rate,
      rateCL: this._rateCL,
      ratio: this._ratio,
    };
  }
}
