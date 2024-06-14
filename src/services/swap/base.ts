import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import { tokenDataByNetwork } from "@gearbox-protocol/sdk-gov";
import { Inject } from "typedi";

import { CONFIG, Config } from "../../config/index.js";
import type { LoggerInterface } from "../../log/index.js";
import Client from "../Client.js";

export default class BaseSwapper {
  @Inject(CONFIG)
  config: Config;

  @Inject()
  client: Client;

  public log: LoggerInterface;

  protected network: NetworkType;
  protected wethAddr: string;

  protected async launch(network: NetworkType): Promise<void> {
    this.network = network;
    this.wethAddr = tokenDataByNetwork[network].WETH;
  }
}
