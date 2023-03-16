import { BigNumberish, Wallet } from "ethers";
import Container, { Service } from "typedi";

import { SWAPPER } from "./constants";
import { ISwapper } from "./types";
import Uniswap from "./uniswapService";

function createSwapper(): ISwapper {
  const swapper = Container.get(Uniswap);
  return swapper;
}

@Service({ factory: createSwapper, id: SWAPPER })
export class Swapper implements ISwapper {
  swap: (
    executor: Wallet,
    tokenAddr: string,
    amount: BigNumberish,
  ) => Promise<void>;
}
