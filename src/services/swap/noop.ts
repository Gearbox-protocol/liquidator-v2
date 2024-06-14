import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import type { Address } from "viem";

import type { ISwapper } from "./types.js";

export default class NoopSwapper implements ISwapper {
  public async launch(_network: NetworkType): Promise<void> {
    // nothing to do here
  }

  public async swap(_tokenAddr: Address, _amount: bigint): Promise<void> {
    // nothing to do here
  }
}
