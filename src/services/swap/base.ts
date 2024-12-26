import type { CreditAccountsService, NetworkType } from "@gearbox-protocol/sdk";
import { WETH } from "@gearbox-protocol/sdk";
import type { Address } from "viem";

import type { Config } from "../../config/index.js";
import { DI } from "../../di.js";
import type Client from "../Client.js";

export default abstract class BaseSwapper {
  @DI.Inject(DI.Config)
  config!: Config;

  @DI.Inject(DI.Client)
  client!: Client;

  @DI.Inject(DI.CreditAccountService)
  creditAccountService!: CreditAccountsService;

  #network?: NetworkType;
  #wethAddr?: Address;

  protected async launch(network: NetworkType): Promise<void> {
    this.#network = network;
    this.#wethAddr = WETH[network];
  }

  protected get network(): NetworkType {
    if (!this.#network) {
      throw new Error("network not initialized");
    }
    return this.#network;
  }

  protected get wethAddr(): Address {
    if (!this.#wethAddr) {
      throw new Error("weth address not initialized");
    }
    return this.#wethAddr;
  }
}
