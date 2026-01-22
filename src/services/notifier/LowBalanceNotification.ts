import type {
  IDedupableNotification,
  INotification,
} from "@gearbox-protocol/cli-utils";
import {
  chains,
  etherscanUrl,
  formatBN,
  type NetworkType,
} from "@gearbox-protocol/sdk";
import { md } from "@vlad-yakovlev/telegram-md";
import type { Address } from "viem";

export class LowBalanceNotification implements INotification {
  readonly #wallet: Address;
  readonly #balance: string;
  readonly #minBalance: string;
  readonly #network: NetworkType;

  constructor(
    network: NetworkType,
    wallet: Address,
    balance: bigint,
    minBalance: bigint,
  ) {
    this.#wallet = wallet;
    this.#network = network;

    const { decimals, symbol } = chains[network].nativeCurrency;
    this.#balance = `${formatBN(balance, decimals)} ${symbol}`;
    this.#minBalance = `${formatBN(minBalance, decimals)} ${symbol}`;
  }

  public messageFor(
    recipient?: Address,
  ): string | IDedupableNotification | undefined {
    if (recipient) {
      return undefined;
    }

    return {
      plain: `[${this.#network}] balance of liquidator ${this.#wallet} is ${this.#balance} is below minumum of ${this.#minBalance}`,
      md: md`[${this.#network}] balance of liquidator ${md.link(this.#wallet, etherscanUrl({ address: this.#wallet }, this.#network))} is ${md.bold(this.#balance)} is below minumum of ${md.bold(this.#minBalance)}`,
      dedupeKey: "low-balance",
    };
  }
}
