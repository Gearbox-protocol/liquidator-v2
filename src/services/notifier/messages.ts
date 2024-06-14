import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import { formatBN } from "@gearbox-protocol/sdk-gov";
import type { Markdown } from "@vlad-yakovlev/telegram-md";
import { md } from "@vlad-yakovlev/telegram-md";
import { Container } from "typedi";
import type { Address, TransactionReceipt } from "viem";

import type { Config } from "../../config/index.js";
import { CONFIG } from "../../config/index.js";
import type { CreditAccountData } from "../../data/index.js";
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
    return md.link(this.ca.cmName, this.cmPlain);
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
    return md.link(this.receipt.transactionHash, this.receiptPlain);
  }
}

export class LowBalanceMessage extends BaseMessage implements INotifierMessage {
  #wallet: Address;
  #balance: bigint;
  #minBalance: bigint;

  constructor(wallet: Address, balance: bigint, minBalance: bigint) {
    super();
    this.#wallet = wallet;
    this.#balance = balance;
    this.#minBalance = minBalance;
  }

  public get plain(): string {
    return `[${this.network}] balance of liquidator ${this.#wallet} is ${formatBN(this.#balance, 18)} ETH is below minumum of ${formatBN(this.#minBalance, 18)} ETH`;
  }

  public get markdown(): string {
    return md.build(
      md`[${this.network}] balance of liquidator ${md.link(this.#wallet, etherscanUrl({ address: this.#wallet }, this.network))} is ${md.bold(formatBN(this.#balance, 18) + " ETH")} is below minumum of ${md.bold(formatBN(this.#minBalance, 18) + " ETH")}`,
    );
  }
}

export class StartedMessage extends BaseMessage implements INotifierMessage {
  #name: string;
  #hfThreshold: number;
  #restakingWA: boolean;

  constructor() {
    super();
    const cfg = Container.get(CONFIG) as Config;
    this.#name = cfg.appName;
    this.#hfThreshold = cfg.hfThreshold;
    this.#restakingWA = !!cfg.restakingWorkaround;
  }

  public get plain(): string {
    return `[${this.network}] started ${this.#name} ${version}
HF threshold: ${this.#hfThreshold}
Restaking workaround: ${this.#restakingWA}
`;
  }

  public get markdown(): string {
    return md.build(md`[${this.network}] started ${this.#name} 
Version: ${md.bold(version)}
HF threshold: ${md.bold(this.#hfThreshold.toString(10))}
Restaking workaround: ${md.bold(this.#restakingWA.toString())}
`);
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
    return `[${this.network}] begin ${this.#strategyName} liquidation of ${this.caPlain} in ${this.cmPlain} with HF ${this.ca?.healthFactor}`;
  }

  public get markdown(): string {
    return md.build(
      md`[${this.network}] begin ${this.#strategyName} liquidation of ${this.caMd} with HF ${md.bold(this.ca?.healthFactor)} in credit manager ${this.cmMd}`,
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
    if (this.receipt?.status === "success") {
      return `✅ [${this.network}] account ${this.caPlain} in credit manager ${this.cmPlain} was ${this.#strategyAdverb} liquidated      
Tx receipt: ${this.receiptPlain}
Gas used: ${this.receipt?.gasUsed?.toLocaleString("en")}
Path used:
${this.#callsHuman.join("\n")}`;
    }
    return `❌ [${this.network}] tried to ${this.#strategyAdverb} liquidate account ${this.caPlain} in credit manager ${this.cmPlain}      
Tx reverted: ${this.receiptPlain}
Gas used: ${this.receipt?.gasUsed?.toLocaleString("en")}
Path used:
${this.#callsHuman.join("\n")}`;
  }

  public get markdown(): string {
    if (this.receipt?.status === "success") {
      return md.build(
        md`✅ [${this.network}] account ${this.caMd} in credit manager ${this.cmMd} was ${this.#strategyAdverb} liquidated
Tx receipt: ${this.receiptMd}
Gas used: ${md.bold(this.receipt?.gasUsed?.toLocaleString("en"))}
Path used:
${callsPlain(this.#callsHuman)}`,
      );
    }
    return md.build(
      md`❌ [${this.network}] tried to ${this.#strategyAdverb} liquidate account ${this.caMd} in credit manager ${this.cmMd}
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
    this.#error = error.length > 128 ? error.slice(0, 128) + "..." : error;
    this.#callsHuman = callsHuman;
  }

  public get plain(): string {
    return `❌ [${this.network}] failed to ${this.#strategyAdverb} liquidate account ${this.caPlain} in credit manager ${this.cmPlain}      
Error: ${this.#error}
Path used:
${callsPlain(this.#callsHuman)}`;
  }

  public get markdown(): string {
    return md.build(
      md`❌ [${this.network}] failed to ${this.#strategyAdverb} liquidate account ${this.caMd} in credit manager ${this.cmMd}
Error: ${md.inlineCode(this.#error)}
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
