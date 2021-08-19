import { Service } from "typedi";
import { Logger, LoggerInterface } from "../decorators/logger";
import {
  IUniswapV2Router02,
  IUniswapV2Router02__factory,
} from "../types/ethers-v5";
import config from "../config";
import { BigNumber, Signer } from "ethers";
import { TradePath } from "../core/tradePath";
import { PERCENTAGE_FACTOR } from "@diesellabs/gearbox-sdk";

@Service()
export class UniswapService {
  @Logger("UniswapService")
  log: LoggerInterface;

  public readonly slippage: number;
  protected _router: IUniswapV2Router02;
  protected _wethToken: string;

  constructor() {
    this.slippage = config.slippage;
  }

  async connect(router: string, wethToken: string, signer: Signer) {
    this._router = IUniswapV2Router02__factory.connect(router, signer);
    this._wethToken = wethToken;
  }

  async findBestRoutes(
    underlyingToken: string,
    allowedTokens: Array<string>,
    balances: Record<string, BigNumber>
  ): Promise<Array<TradePath>> {
    return Promise.all(
      allowedTokens.map((token) =>
        this._findRoute(token, underlyingToken, balances[token])
      )
    );
  }

  protected async _findRoute(
    fromToken: string,
    toToken: string,
    amount: BigNumber
  ): Promise<TradePath> {
    if (amount.isZero()) {
      return { path: [], amountOutMin: BigNumber.from(0) };
    }

    const paths = [
      [fromToken, toToken],
      [fromToken, this._wethToken, toToken],
    ];

    const promises = paths.map((p) => this._router.getAmountsOut(amount, p));

    const result = await Promise.allSettled(promises);

    console.log(result[0]);

    let bestAmountOut = BigNumber.from(0);
    let bestPath: Array<string> = [];
    for (let i = 0; i < paths.length; i++) {
      const pRate = result[i];
      if (pRate.status === "fulfilled") {
        // @ts-ignore
        const { value } = pRate;

        if (value[0].gt(bestAmountOut)) {
          bestAmountOut = value[0];
          bestPath = paths[i];
        }
      }
    }

    return {
      path: bestPath,
      amountOutMin: BigNumber.from(0)// bestAmountOut
        // .mul(PERCENTAGE_FACTOR)
        // .div(PERCENTAGE_FACTOR + Math.floor(100 * this.slippage)),
    };
  }
}
