import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import { tokenDataByNetwork } from "@gearbox-protocol/sdk-gov";

import type { LoggerInterface } from "../../log/index.js";

export default class BaseSwapper {
  public log: LoggerInterface;

  protected network: NetworkType;
  protected wethAddr: string;

  protected async launch(network: NetworkType): Promise<void> {
    this.network = network;
    this.wethAddr = tokenDataByNetwork[network].WETH;
  }
}
