import type { NetworkType } from "@gearbox-protocol/sdk";
import { tokenDataByNetwork } from "@gearbox-protocol/sdk";

import type { LoggerInterface } from "../../decorators/logger";

export default class BaseSwapper {
  public log: LoggerInterface;

  protected network: NetworkType;
  protected wethAddr: string;

  protected async launch(network: NetworkType): Promise<void> {
    this.network = network;
    this.wethAddr = tokenDataByNetwork[network].WETH;
  }
}
