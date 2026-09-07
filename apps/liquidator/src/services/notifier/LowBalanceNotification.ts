import type {
  IDedupableNotification,
  INotification,
} from "@gearbox-protocol/cli-utils";
import {
  chains,
  etherscanUrl,
  formatBN,
  type NetworkType,
} from "@gearbox-protocol/sdk/onchain";
import { md } from "@vlad-yakovlev/telegram-md";
import type { Address } from "viem";
import { formatGwei } from "viem";

export class LowBalanceNotification implements INotification {
  readonly #wallet: Address;
  readonly #balance: string;
  readonly #minBalance: string;
  readonly #budget: string;
  readonly #network: NetworkType;

  constructor(
    network: NetworkType,
    wallet: Address,
    balance: bigint,
    minBalance: bigint,
    minBalanceGas: bigint,
    gasPrice: bigint,
  ) {
    this.#wallet = wallet;
    this.#network = network;

    const { decimals, symbol } = chains[network].nativeCurrency;
    this.#balance = `${formatBN(balance, decimals)} ${symbol}`;
    this.#minBalance = `${formatBN(minBalance, decimals)} ${symbol}`;
    this.#budget = `${minBalanceGas} gas at ${formatGwei(gasPrice)} gwei`;
  }

  public messageFor(
    recipient?: Address,
  ): string | IDedupableNotification | undefined {
    if (recipient) {
      return undefined;
    }

    return {
      plain: `[${this.#network}] balance of liquidator ${this.#wallet} is ${this.#balance}, below required minimum of ${this.#minBalance} (budget ${this.#budget})`,
      md: md`[${this.#network}] balance of liquidator ${md.link(this.#wallet, etherscanUrl({ address: this.#wallet }, this.#network))} is ${md.bold(this.#balance)}, below required minimum of ${md.bold(this.#minBalance)} (budget ${md.bold(this.#budget)})`,
      dedupeKey: "low-balance",
    };
  }
}
