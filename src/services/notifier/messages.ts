import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import { formatBN } from "@gearbox-protocol/sdk-gov";
import type { Markdown } from "@vlad-yakovlev/telegram-md";
import { md } from "@vlad-yakovlev/telegram-md";
import type { TransactionReceipt, Wallet } from "ethers";
import { Container } from "typedi";

import type { Config } from "../../config/index.js";
import { CONFIG } from "../../config/index.js";
import type { CreditAccountData } from "../../utils/ethers-6-temp/index.js";
import { etherscanUrl } from "../../utils/index.js";
import version from "../../version.js";
import type { INotifierMessage } from "./types.js";

interface BaseMessageOptions {
  ca?: CreditAccountData;
  receipt?: TransactionReceipt;
}

class BaseMessage {
  protected readonly network: NetworkType;
  protected readonly ca?: CreditAccountData;
  protected readonly receipt?: TransactionReceipt;

  constructor(opts: BaseMessageOptions = {}) {
    this.network = (Container.get(CONFIG) as Config).network;
    this.ca = opts.ca;
    this.receipt = opts.receipt;
  }

  protected get caPlain(): string {
    if (!this.ca) {
      throw new Error(`credit account not specified`);
    }
    return etherscanUrl(this.ca, this.network);
  }

  protected get caMd(): Markdown {
    if (!this.ca) {
      throw new Error(`credit account not specified`);
    }
    return md.link(this.ca?.addr, this.caPlain);
  }

  protected get cmPlain(): string {
    if (!this.ca) {
      throw new Error(`credit account not specified`);
    }
    return etherscanUrl({ address: this.ca.creditManager }, this.network);
  }

  protected get cmMd(): Markdown {
    if (!this.ca) {
      throw new Error(`credit account not specified`);
    }
    return md.link(this.ca.creditManager, this.cmPlain);
  }

  protected get receiptPlain(): string {
    if (!this.receipt) {
      throw new Error(`receipt not specified`);
    }
    return etherscanUrl(this.receipt, this.network);
  }

  protected get receiptMd(): Markdown {
    if (!this.receipt) {
      throw new Error(`receipt not specified`);
    }
    return md.link(this.receipt.hash, this.receiptPlain);
  }
}

export class LowBalanceMessage extends BaseMessage implements INotifierMessage {
  #wallet: Wallet;
  #balance: bigint;
  #minBalance: bigint;

  constructor(wallet: Wallet, balance: bigint, minBalance: bigint) {
    super();
    this.#wallet = wallet;
    this.#balance = balance;
    this.#minBalance = minBalance;
  }

  public get plain(): string {
    return `balance of liquidator ${this.#wallet.address} is ${formatBN(this.#balance, 18)} ETH is below minumum of ${formatBN(this.#minBalance, 18)} ETH`;
  }

  public get markdown(): string {
    return md.build(
      md`balance of liquidator ${md.link(this.#wallet.address, etherscanUrl(this.#wallet, this.network))} is ${md.bold(formatBN(this.#balance, 18) + " ETH")} is below minumum of ${md.bold(formatBN(this.#minBalance, 18) + " ETH")}`,
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

export class LiquidationStartMessage
  extends BaseMessage
  implements INotifierMessage
{
  #strategyName: string;

  constructor(ca: CreditAccountData, strategyName: string) {
    super({ ca });
    this.#strategyName = strategyName;
  }

  public get plain(): string {
    return `begin ${this.#strategyName} liquidation of ${this.caPlain} in ${this.cmPlain} with HF ${this.ca?.healthFactor}`;
  }

  public get markdown(): string {
    return md.build(
      md`begin ${this.#strategyName} liquidation of ${this.caMd} with HF ${md.bold(this.ca?.healthFactor)} in credit manager ${this.cmMd}`,
    );
  }
}

export class LiquidationSuccessMessage
  extends BaseMessage
  implements INotifierMessage
{
  #callsHuman: string[];
  #strategyAdverb: string;

  constructor(
    ca: CreditAccountData,
    strategyAdverb: string,
    receipt: TransactionReceipt,
    callsHuman: string[],
  ) {
    super({ ca, receipt });
    this.#strategyAdverb = strategyAdverb;
    this.#callsHuman = callsHuman;
  }

  public get plain(): string {
    if (this.receipt?.status === 1) {
      return `✅ account ${this.caPlain} in credit manager ${this.cmPlain} was ${this.#strategyAdverb} liquidated      
Tx receipt: ${this.receiptPlain}
Gas used: ${this.receipt?.gasUsed?.toLocaleString("en")}
Path used:
${this.#callsHuman.join("\n")}`;
    }
    return `❌ tried to ${this.#strategyAdverb} liquidate account ${this.caPlain} in credit manager ${this.cmPlain}      
Tx reverted: ${this.receiptPlain}
Gas used: ${this.receipt?.gasUsed?.toLocaleString("en")}
Path used:
${this.#callsHuman.join("\n")}`;
  }

  public get markdown(): string {
    if (this.receipt?.status === 1) {
      return md.build(
        md`✅ account ${this.caMd} in credit manager ${this.cmMd} was ${this.#strategyAdverb} liquidated
Tx receipt: ${this.receiptMd}
Gas used: ${md.bold(this.receipt?.gasUsed?.toLocaleString("en"))}
Path used:
${callsPlain(this.#callsHuman)}`,
      );
    }
    return md.build(
      md`❌ tried to ${this.#strategyAdverb} liquidate account ${this.caMd} in credit manager ${this.cmMd}
Tx reverted: ${this.receiptMd}
Path used:
${callsMd(this.#callsHuman)}`,
    );
  }
}

export class LiquidationErrorMessage
  extends BaseMessage
  implements INotifierMessage
{
  #error: string;
  #callsHuman?: string[];
  #strategyAdverb: string;

  constructor(
    ca: CreditAccountData,
    strategyAdverb: string,
    error: string,
    callsHuman?: string[],
  ) {
    super({ ca });
    this.#strategyAdverb = strategyAdverb;
    this.#error = error;
    this.#callsHuman = callsHuman;
  }

  public get plain(): string {
    return `❌ failed to ${this.#strategyAdverb} liquidate account ${this.caPlain} in credit manager ${this.cmPlain}      
Error: ${this.#error}
Path used:
${callsPlain(this.#callsHuman)}`;
  }

  public get markdown(): string {
    return md.build(
      md`❌ failed to ${this.#strategyAdverb} liquidate account ${this.caMd} in credit manager ${this.cmMd}
Error: ${md.codeBlock(this.#error)}
Path used:
${callsMd(this.#callsHuman)}`,
    );
  }
}

function callsPlain(calls?: string[]): string {
  return calls ? calls.map(c => " ➤ " + c).join("\n") : "-";
}

function callsMd(calls?: string[]): Markdown {
  return calls
    ? md.join(
        calls.map(c => " ➤ " + c),
        "\n",
      )
    : // prettier-ignore
      md`-`;
}
