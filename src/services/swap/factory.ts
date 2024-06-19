import type { IFactory } from "di-at-home";

import type { Config } from "../../config/index.js";
import { DI } from "../../di.js";
import NoopSwapper from "./noop.js";
import OneInch from "./oneInch.js";
import type { ISwapper } from "./types.js";
import Uniswap from "./uniswap.js";

@DI.Factory(DI.Swapper)
export class SwapperFactory implements IFactory<ISwapper, []> {
  @DI.Inject(DI.Config)
  config!: Config;

  produce(): ISwapper {
    switch (this.config.swapToEth) {
      case "uniswap":
        return new Uniswap();
      case "1inch":
        return new OneInch();
      case undefined:
        return new NoopSwapper();
      default:
        throw new Error(`unknown swapper ${this.config.swapToEth}`);
    }
  }
}
