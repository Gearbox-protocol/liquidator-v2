import type {
  IDedupableNotification,
  INotification,
} from "@gearbox-protocol/cli-utils";
import type {
  CreditAccountData,
  OnchainSDK,
} from "@gearbox-protocol/sdk/onchain";
import { type Markdown, md } from "@vlad-yakovlev/telegram-md";
import type { Address } from "viem";
import { censor } from "../../log/censor.js";
import AccountNotification from "./AccountNotification.js";
import joinCalls from "./joinCalls.js";

export class LiquidationErrorNotification
  extends AccountNotification
  implements INotification
{
  readonly #error: string;
  readonly #callsHuman?: string[];
  readonly #strategyName: string;
  readonly #whitelistReason?: string;

  constructor(
    sdk: OnchainSDK,
    ca: CreditAccountData,
    strategyName: string,
    error: string,
    callsHuman?: string[],
    whitelistReason?: string,
  ) {
    super(sdk, ca);
    this.#strategyName = strategyName;
    const censored = censor(error);
    this.#error =
      censored.length > 128 ? `${censored.slice(0, 128)}...` : censored;
    this.#callsHuman = callsHuman;
    this.#whitelistReason = whitelistReason;
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

  get #whitelistPlain(): string {
    return this.#whitelistReason !== undefined
      ? `\n⚠️ whitelisted: ${this.#whitelistReason}`
      : "";
  }

  get #plain(): string {
    return `❌ [${this.networkType}] ${this.#strategyName} liquidation failed for account ${this.caPlain} ${this.withHF} in credit manager ${this.cmPlain}      
Error: ${this.#error}${this.#whitelistPlain}
Path used:
${joinCalls.plain(this.#callsHuman)}`;
  }

  get #markdown(): Markdown {
    const whitelist =
      this.#whitelistReason !== undefined
        ? md`\n⚠️ whitelisted: ${this.#whitelistReason}`
        : "";
    return md`❌ [${this.networkType}] ${this.#strategyName} liquidation failed for account ${this.caMd} ${this.withHF} in credit manager ${this.cmMd}
Error: ${md.inlineCode(this.#error)}${whitelist}
Path used:
${joinCalls.md(this.#callsHuman)}`;
  }
}
