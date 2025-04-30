import {
  type CreditAccountsService,
  type NetworkType,
  NOT_DEPLOYED,
} from "@gearbox-protocol/sdk";
import type { Address } from "viem";

import type { Config } from "../../config/index.js";
import { DI } from "../../di.js";
import type Client from "../Client.js";

export const WETH: Record<NetworkType, Address> = {
  Mainnet: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  Arbitrum: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  Optimism: "0x4200000000000000000000000000000000000006",
  Base: "0x4200000000000000000000000000000000000006",
  Sonic: "0x50c42dEAcD8Fc9773493ED674b675bE577f2634b",
  MegaETH: "0x4eB2Bd7beE16F38B1F4a0A5796Fffd028b6040e9",
  Monad: "0xB5a30b0FDc5EA94A52fDc42e3E9760Cb8449Fb37",
  Berachain: "0x2f6f07cdcf3588944bf4c42ac74ff24bf56e7590",
  Avalanche: "0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab",
  BNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  WorldChain: NOT_DEPLOYED,
};

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
