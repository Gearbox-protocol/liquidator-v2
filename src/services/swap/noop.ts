import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import type { BigNumberish, Wallet } from "ethers";

import type { ISwapper } from "./types.js";

export default class NoopSwapper implements ISwapper {
  public async launch(_network: NetworkType): Promise<void> {
    // nothing to do here
  }

  public async swap(
    _executor: Wallet,
    _tokenAddr: string,
    _amount: BigNumberish,
    recipient?: string,
  ): Promise<void> {
    // nothing to do here
  }
}
