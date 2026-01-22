import type {
  IDedupableNotification,
  INotification,
} from "@gearbox-protocol/cli-utils";
import type { CreditAccountData, GearboxSDK } from "@gearbox-protocol/sdk";
import { type Markdown, md } from "@vlad-yakovlev/telegram-md";
import type { Address, TransactionReceipt } from "viem";
import AccountNotification from "./AccountNotification.js";
import joinCalls from "./joinCalls.js";
import prettyReceipt from "./prettyReceipt.js";

export class LiquidationSuccessNotification
  extends AccountNotification
  implements INotification
{
  #callsHuman: string[];
  #strategyAdverb: string;

  constructor(
    sdk: GearboxSDK,
    ca: CreditAccountData,
    receipt: TransactionReceipt,
    strategyAdverb: string,
    callsHuman: string[],
  ) {
    super(sdk, ca, receipt);
    this.#strategyAdverb = strategyAdverb;
    this.#callsHuman = callsHuman;
  }

  public messageFor(
    recipient?: Address,
  ): string | IDedupableNotification | undefined {
    if (!this.forMarketConfigurator(recipient)) {
      return undefined;
    }
    return {
      dedupeKey: `success-${this.ca.creditAccount.toLowerCase()}`,
      plain: this.#plain,
      md: this.#markdown,
    };
  }

  get #plain(): string {
    if (this.receipt?.status === "success") {
      return `✅ [${this.networkType}] account ${this.caPlain} in credit manager ${this.cmPlain} was ${this.#strategyAdverb} liquidated      
Tx receipt: ${prettyReceipt.plain(this)}
Gas used: ${this.receipt?.gasUsed?.toLocaleString("en")}
Path used:
${joinCalls.plain(this.#callsHuman)}`;
    }
    return `❌ [${this.networkType}] tried to ${this.#strategyAdverb} liquidate account ${this.caPlain} in credit manager ${this.cmPlain}      
Tx reverted: ${prettyReceipt.plain(this)}
Gas used: ${this.receipt?.gasUsed?.toLocaleString("en")}
Path used:
${joinCalls.plain(this.#callsHuman)}`;
  }

  get #markdown(): Markdown {
    if (this.receipt?.status === "success") {
      return md`✅ [${this.networkType}] account ${this.caMd} in credit manager ${this.cmMd} was ${this.#strategyAdverb} liquidated
Tx receipt: ${prettyReceipt.md(this)}
Gas used: ${md.bold(this.receipt?.gasUsed?.toLocaleString("en"))}
Path used:
${joinCalls.md(this.#callsHuman)}`;
    }
    return md`❌ [${this.networkType}] tried to ${this.#strategyAdverb} liquidate account ${this.caMd} in credit manager ${this.cmMd}
Tx reverted: ${prettyReceipt.md(this)}
Path used:
${joinCalls.md(this.#callsHuman)}`;
  }
}
