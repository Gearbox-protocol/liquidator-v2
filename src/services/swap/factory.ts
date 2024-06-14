import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import { Container, Service } from "typedi";
import type { Address } from "viem";

import type { Config } from "../../config/index.js";
import { CONFIG } from "../../config/index.js";
import { SWAPPER } from "./constants.js";
import NoopSwapper from "./noop.js";
import OneInch from "./oneInch.js";
import type { ISwapper } from "./types.js";
import Uniswap from "./uniswap.js";

function createSwapper(): ISwapper {
  const config = Container.get(CONFIG) as Config;
  switch (config.swapToEth) {
    case "uniswap":
      return Container.get(Uniswap);
    case "1inch":
      return Container.get(OneInch);
    case undefined:
      return new NoopSwapper();
    default:
      throw new Error(`unknown swapper ${config.swapToEth}`);
  }
}

@Service({ factory: createSwapper, id: SWAPPER })
export class Swapper implements ISwapper {
  launch: (network: NetworkType) => Promise<void>;
  swap: (tokenAddr: Address, amount: bigint) => Promise<void>;
}
