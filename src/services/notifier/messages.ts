import type { CreditAccountData, NetworkType } from "@gearbox-protocol/sdk";
import {
  etherscanUrl,
  formatBN,
  PERCENTAGE_FACTOR,
  WAD,
} from "@gearbox-protocol/sdk";
import type { OptimisticResult } from "@gearbox-protocol/types/optimist";
import type { Markdown } from "@vlad-yakovlev/telegram-md";
import { md } from "@vlad-yakovlev/telegram-md";
import type { Address, BaseError, TransactionReceipt } from "viem";

import type { Config } from "../../config/index.js";
import { DI } from "../../di.js";
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
    this.network = (DI.get(DI.Config) as Config).network;
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
    return md.link(this.ca?.creditAccount, this.caPlain);
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
    return md.link(this.receipt.transactionHash, this.receiptPlain);
  }

  protected get withHF(): string {
    if (!this.ca) {
      return "";
    }
    const hfStr = (
      Number((this.ca.healthFactor * PERCENTAGE_FACTOR) / WAD) / 100_00
    ).toString(10);
    return `with HF ${hfStr}`;
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
      md`[${this.network}] balance of liquidator ${md.link(this.#wallet, etherscanUrl({ address: this.#wallet }, this.network))} is ${md.bold(`${formatBN(this.#balance, 18)} ETH`)} is below minumum of ${md.bold(`${formatBN(this.#minBalance, 18)} ETH`)}`,
    );
  }
}

export class StartedMessage extends BaseMessage implements INotifierMessage {
  #name: string;
  #hfThreshold: bigint;
  #restakingWA: boolean;

  constructor() {
    super();
    const cfg = DI.get(DI.Config) as Config;
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
  constructor(ca: CreditAccountData) {
    super({ ca });
  }

  public get plain(): string {
    return `[${this.network}] begin liquidation of ${this.caPlain} ${this.withHF} in ${this.cmPlain}`;
  }

  public get markdown(): string {
    return md.build(
      md`[${this.network}] begin liquidation of ${this.caMd} ${this.withHF} in credit manager ${this.cmMd}`,
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

export class BatchLiquidationFinishedMessage
  extends BaseMessage
  implements INotifierMessage
{
  #liquidated: number;
  #notLiquidated: number;

  constructor(
    receipt: TransactionReceipt,
    results: OptimisticResult<bigint>[],
  ) {
    super({ receipt });
    this.#liquidated = results.filter(r => !r.isError).length;
    this.#notLiquidated = results.filter(r => !!r.isError).length;
  }

  public get plain(): string {
    if (this.receipt?.status === "success") {
      if (this.#notLiquidated === 0) {
        return `✅ [${this.network}] batch-liquidated ${this.#liquidated} accounts:      
Tx receipt: ${this.receiptPlain}
Gas used: ${this.receipt?.gasUsed?.toLocaleString("en")}`;
      } else {
        return `❌ [${this.network}] batch-liquidated ${this.#liquidated} accounts, but failed to liquidate ${this.#notLiquidated} more      
Tx receipt: ${this.receiptPlain}
Gas used: ${this.receipt?.gasUsed?.toLocaleString("en")}`;
      }
    }

    return `❌ [${this.network}] batch-liquidate tx reverted      
Tx: ${this.receiptPlain}`;
  }

  public get markdown(): string {
    if (this.receipt?.status === "success") {
      if (this.#notLiquidated === 0) {
        return md.build(
          md`✅ [${this.network}] batch-liquidated ${this.#liquidated} accounts
Tx receipt: ${this.receiptMd}
Gas used: ${md.bold(this.receipt?.gasUsed?.toLocaleString("en"))}`,
        );
      } else {
        return md.build(
          md`❌ [${this.network}] batch-liquidated ${this.#liquidated} accounts, but failed to liquidate ${this.#notLiquidated} more
Tx receipt: ${this.receiptMd}
Gas used: ${md.bold(this.receipt?.gasUsed?.toLocaleString("en"))}`,
        );
      }
    }
    return md.build(
      md`❌ [${this.network}] batch-liquidate tx reverted
Tx: ${this.receiptMd}`,
    );
  }
}

export class LiquidationErrorMessage
  extends BaseMessage
  implements INotifierMessage
{
  #error: string;
  #callsHuman?: string[];
  #strategyName: string;

  constructor(
    ca: CreditAccountData,
    strategyName: string,
    error: string,
    callsHuman?: string[],
  ) {
    super({ ca });
    this.#strategyName = strategyName;
    this.#error = error.length > 128 ? `${error.slice(0, 128)}...` : error;
    this.#callsHuman = callsHuman;
  }

  public get plain(): string {
    return `❌ [${this.network}] ${this.#strategyName} liquidation failed for account ${this.caPlain} ${this.withHF} in credit manager ${this.cmPlain}      
Error: ${this.#error}
Path used:
${callsPlain(this.#callsHuman)}`;
  }

  public get markdown(): string {
    return md.build(
      md`❌ [${this.network}] ${this.#strategyName} liquidation failed for account ${this.caMd} ${this.withHF} in credit manager ${this.cmMd}
Error: ${md.inlineCode(this.#error)}
Path used:
${callsMd(this.#callsHuman)}`,
    );
  }
}
export class BatchLiquidationErrorMessage
  extends BaseMessage
  implements INotifierMessage
{
  #error: string;
  #accounts: CreditAccountData[];

  constructor(accounts: CreditAccountData[], error: string) {
    super({});
    this.#accounts = accounts;
    this.#error = error.length > 128 ? `${error.slice(0, 128)}...` : error;
  }

  public get plain(): string {
    return `❌ [${this.network}] failed to batch-liquidate ${this.#accounts.length} accounts      
Error: ${this.#error}`;
  }

  public get markdown(): string {
    return md.build(
      md`❌ [${this.network}] failed to batch-liquidate ${this.#accounts.length} accounts
Error: ${md.inlineCode(this.#error)}`,
    );
  }
}

export class ProviderRotationSuccessMessage
  extends BaseMessage
  implements INotifierMessage
{
  #oldT: string;
  #newT: string;
  #reason: string;

  constructor(oldT: string, newT: string, reason?: BaseError) {
    super({});
    this.#oldT = oldT;
    this.#newT = newT;
    this.#reason = reason ? `: ${reason.shortMessage} ${reason.details}` : "";
  }

  public get plain(): string {
    return `[${this.network}] rotated rpc provider from ${this.#oldT} to ${this.#newT}${this.#reason}`;
  }

  public get markdown(): string {
    return md.build(
      md`[${this.network}] rotated rpc provider from ${md.bold(this.#oldT)} to ${md.bold(this.#newT)}${this.#reason}`,
    );
  }
}

export class ProviderRotationErrorMessage
  extends BaseMessage
  implements INotifierMessage
{
  #oldT: string;
  #reason: string;

  constructor(oldT: string, reason?: BaseError) {
    super({});
    this.#oldT = oldT;
    this.#reason = reason ? `: ${reason.shortMessage} ${reason.details}` : "";
  }

  public get plain(): string {
    return `[${this.network}] failed to rotate rpc provider from ${this.#oldT}${this.#reason}`;
  }

  public get markdown(): string {
    return md.build(
      md`[${this.network}] failed to rotate rpc provider from ${md.bold(this.#oldT)}${this.#reason}`,
    );
  }
}

export class ZeroHFAccountsMessage
  extends BaseMessage
  implements INotifierMessage
{
  #count: number;
  #badTokens: string;

  constructor(count: number, badTokens: string) {
    super({});
    this.#count = count;
    this.#badTokens = badTokens;
  }

  public get plain(): string {
    return `[${this.network}] found ${this.#count} accounts with HF=0, bad tokens: ${this.#badTokens}`;
  }

  public get markdown(): string {
    return md.build(
      md`[${this.network}] found ${this.#count} accounts with HF=0, bad tokens: ${this.#badTokens}`,
    );
  }
}

function callsPlain(calls?: string[]): string {
  return calls ? calls.map(c => ` ➤ ${c}`).join("\n") : "-";
}

function callsMd(calls?: string[]): Markdown {
  return calls
    ? md.join(
        calls.map(c => ` ➤ ${c}`),
        "\n",
      )
    : // prettier-ignore
      md`-`;
}
