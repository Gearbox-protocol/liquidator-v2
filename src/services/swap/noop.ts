import { NetworkType } from "@gearbox-protocol/sdk";
import { BigNumberish, Wallet } from "ethers";

import { ISwapper } from "./types";

export default class NoopSwapper implements ISwapper {
  launch: (network: NetworkType) => Promise<void>;
  public async swap(
    _executor: Wallet,
    _tokenAddr: string,
    _amount: BigNumberish,
  ): Promise<void> {
    // nothing to do here
  }
}
