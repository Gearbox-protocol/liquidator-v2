import type { NetworkType } from "@gearbox-protocol/sdk";
import type { BigNumberish, Wallet } from "ethers";
import Container, { Service } from "typedi";

import config from "../../config";
import { SWAPPER } from "./constants";
import NoopSwapper from "./noop";
import OneInch from "./oneInch";
import type { ISwapper } from "./types";
import Uniswap from "./uniswap";

function createSwapper(): ISwapper {
  switch (config.swapToEth) {
    case "uniswap":
      return Container.get(Uniswap);
    case "1inch":
      return Container.get(OneInch);
    case "":
    case undefined:
      return new NoopSwapper();
    default:
      throw new Error(`unknown swapper ${config.swapToEth}`);
  }
}

@Service({ factory: createSwapper, id: SWAPPER })
export class Swapper implements ISwapper {
  launch: (network: NetworkType) => Promise<void>;
  swap: (
    executor: Wallet,
    tokenAddr: string,
    amount: BigNumberish,
    recipient?: string,
  ) => Promise<string | null>;
}
