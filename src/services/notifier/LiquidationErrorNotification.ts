import type {
  IDedupableNotification,
  INotification,
} from "@gearbox-protocol/cli-utils";
import type { CreditAccountData, GearboxSDK } from "@gearbox-protocol/sdk";
import { type Markdown, md } from "@vlad-yakovlev/telegram-md";
import type { Address } from "viem";
import AccountNotification from "./AccountNotification.js";
import joinCalls from "./joinCalls.js";

export class LiquidationErrorNotification
  extends AccountNotification
  implements INotification
{
  readonly #error: string;
  readonly #callsHuman?: string[];
  readonly #strategyName: string;

  constructor(
    sdk: GearboxSDK,
    ca: CreditAccountData,
    strategyName: string,
    error: string,
    callsHuman?: string[],
  ) {
    super(sdk, ca);
    this.#strategyName = strategyName;
    this.#error = error.length > 128 ? `${error.slice(0, 128)}...` : error;
    this.#callsHuman = callsHuman;
  }

  public messageFor(
    recipient?: Address,
  ): string | IDedupableNotification | undefined {
    if (!this.forMarketConfigurator(recipient)) {
      return undefined;
    }
    return {
      dedupeKey: `error-${this.ca.creditAccount.toLowerCase()}`,
      plain: this.#plain,
      md: this.#markdown,
    };
  }

  get #plain(): string {
    return `❌ [${this.networkType}] ${this.#strategyName} liquidation failed for account ${this.caPlain} ${this.withHF} in credit manager ${this.cmPlain}      
Error: ${this.#error}
Path used:
${joinCalls.plain(this.#callsHuman)}`;
  }

  get #markdown(): Markdown {
    return md`❌ [${this.networkType}] ${this.#strategyName} liquidation failed for account ${this.caMd} ${this.withHF} in credit manager ${this.cmMd}
Error: ${md.inlineCode(this.#error)}
Path used:
${joinCalls.md(this.#callsHuman)}`;
  }
}
