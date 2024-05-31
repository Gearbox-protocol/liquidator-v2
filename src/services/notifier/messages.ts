import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import { formatBN } from "@gearbox-protocol/sdk-gov";
import { md } from "@vlad-yakovlev/telegram-md";
import type { TransactionReceipt } from "ethers";
import { Container } from "typedi";

import type { Config } from "../../config";
import { CONFIG } from "../../config";
import { etherscanUrl } from "../../utils";
import type { CreditAccountData } from "../../utils/ethers-6-temp";
import version from "../../version";
import type { INotifierMessage } from "./types";

export class LowBalanceMessage implements INotifierMessage {
  #wallet: string;
  #balance: bigint;
  #minBalance: bigint;
  #network: NetworkType;

  constructor(wallet: string, balance: bigint, minBalance: bigint) {
    this.#wallet = wallet;
    this.#balance = balance;
    this.#minBalance = minBalance;
    this.#network = (Container.get(CONFIG) as Config).network;
  }

  public get plain(): string {
    return `balance of liquidator ${this.#wallet} is ${formatBN(this.#balance, 18)} ETH is below minumum of ${formatBN(this.#minBalance, 18)} ETH`;
  }

  public get markdown(): string {
    return md.build(
      md`balance of liquidator ${md.link(this.#wallet, etherscanUrl({ address: this.#wallet }, this.#network))} is ${md.bold(formatBN(this.#balance, 18))} ETH is below minumum of ${md.bold(formatBN(this.#minBalance, 18))} ETH`,
    );
  }
}

export class StartedMessage implements INotifierMessage {
  #name: string;

  constructor() {
    this.#name = (Container.get(CONFIG) as Config).appName;
  }

  public get plain(): string {
    return `started ${this.#name} ${version}`;
  }

  public get markdown(): string {
    return this.plain;
  }
}

export class LiquidationStartMessage implements INotifierMessage {
  #ca: CreditAccountData;
  #strategyName: string;
  #network: NetworkType;

  constructor(acc: CreditAccountData, strategyName: string) {
    this.#ca = acc;
    this.#strategyName = strategyName;
    this.#network = (Container.get(CONFIG) as Config).network;
  }

  public get plain(): string {
    return `begin ${this.#strategyName} liquidation of ${this.#ca.name} with HF ${this.#ca.healthFactor}`;
  }

  public get markdown(): string {
    return md.build(
      md`begin ${this.#strategyName} liquidation of ${md.link(this.#ca.addr, etherscanUrl({ address: this.#ca.addr }, this.#network))} with HF ${md.bold(this.#ca.healthFactor)} in credit manager ${md.link(this.#ca.cmName, etherscanUrl({ address: this.#ca.creditManager }, this.#network))}`,
    );
  }
}

export class LiquidationSuccessMessage implements INotifierMessage {
  #ca: CreditAccountData;
  #receipt: TransactionReceipt;
  #callsHuman: string[];
  #strategyAdverb: string;
  #network: NetworkType;

  constructor(
    acc: CreditAccountData,
    strategyAdverb: string,
    receipt: TransactionReceipt,
    callsHuman: string[],
  ) {
    this.#ca = acc;
    this.#strategyAdverb = strategyAdverb;
    this.#receipt = receipt;
    this.#callsHuman = callsHuman;
    this.#network = (Container.get(CONFIG) as Config).network;
  }

  public get plain(): string {
    if (this.#receipt.status === 1) {
      return `✅ account ${md.link(this.#ca.addr, etherscanUrl({ address: this.#ca.addr }, this.#network))} in credit manager ${md.link(this.#ca.cmName, etherscanUrl({ address: this.#ca.creditManager }, this.#network))} was ${this.#strategyAdverb} liquidated      
    Tx receipt: ${etherscanUrl(this.#receipt, this.#network)}
    Gas used: ${this.#receipt.gasUsed.toLocaleString("en")}
    Path used:
    ${this.#callsHuman.join("\n")}`;
    }
    return `❌ tried to ${this.#strategyAdverb} liquidate account ${md.link(this.#ca.addr, etherscanUrl({ address: this.#ca.addr }, this.#network))} in credit manager ${md.link(this.#ca.cmName, etherscanUrl({ address: this.#ca.creditManager }, this.#network))}      
    Tx reverted: ${etherscanUrl(this.#receipt, this.#network)}
    Gas used: ${this.#receipt.gasUsed.toLocaleString("en")}
    Path used:
    ${this.#callsHuman.join("\n")}`;
  }

  public get markdown(): string {
    if (this.#receipt.status === 1) {
      return md.build(
        md`✅ account ${md.link(etherscanUrl(this.#ca, this.#network), this.#ca.addr)} in credit manager ${md.link(this.#ca.cmName, etherscanUrl({ address: this.#ca.creditManager }, this.#network))} was ${this.#strategyAdverb} liquidated

Tx receipt: ${etherscanUrl(this.#receipt, this.#network)}

Gas used: ${this.#receipt.gasUsed.toLocaleString("en")}

Path used:
${md.join(
  this.#callsHuman.map(c => " ➤ " + c),
  "\n",
)}`,
      );
    }
    return md.build(
      md`❌ tried to ${this.#strategyAdverb} liquidate account ${md.link(etherscanUrl(this.#ca, this.#network), this.#ca.addr)} in credit manager ${md.link(this.#ca.cmName, etherscanUrl({ address: this.#ca.creditManager }, this.#network))}

Tx reverted: ${etherscanUrl(this.#receipt, this.#network)}

Path used:
${md.join(
  this.#callsHuman.map(c => " ➤ " + c),
  "\n",
)}`,
    );
  }
}

export class LiquidationErrorMessage implements INotifierMessage {
  #ca: CreditAccountData;
  #error: string;
  #callsHuman?: string[];
  #strategyAdverb: string;
  #network: NetworkType;

  constructor(
    acc: CreditAccountData,
    strategyAdverb: string,
    error: string,
    callsHuman?: string[],
  ) {
    this.#ca = acc;
    this.#strategyAdverb = strategyAdverb;
    this.#error = error;
    this.#callsHuman = callsHuman;
    this.#network = (Container.get(CONFIG) as Config).network;
  }

  public get plain(): string {
    return `❌ failed to ${this.#strategyAdverb} liquidate account ${md.link(this.#ca.addr, etherscanUrl({ address: this.#ca.addr }, this.#network))} in credit manager ${md.link(this.#ca.cmName, etherscanUrl({ address: this.#ca.creditManager }, this.#network))}      
    Error: ${this.#error}
    Path used:
    ${this.#callsHuman?.join("\n") ?? "-"}`;
  }

  public get markdown(): string {
    return md.build(
      md`❌ failed to ${this.#strategyAdverb} liquidate account ${md.link(etherscanUrl(this.#ca, this.#network), this.#ca.addr)} in credit manager ${md.link(this.#ca.cmName, etherscanUrl({ address: this.#ca.creditManager }, this.#network))}

Error: ${md.codeBlock(this.#error)}

Path used:
${
  this.#callsHuman
    ? md.join(
        this.#callsHuman.map(c => " ➤ " + c),
        "\n",
      )
    : "-"
}`,
    );
  }
}
