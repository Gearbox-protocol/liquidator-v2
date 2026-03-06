import crypto from "node:crypto";
import type {
  IDedupableNotification,
  INotification,
} from "@gearbox-protocol/cli-utils";
import {
  AddressSet,
  type CreditAccountData,
  type GearboxSDK,
  SDKConstruct,
} from "@gearbox-protocol/sdk";
import { type Markdown, md } from "@vlad-yakovlev/telegram-md";
import type { Address } from "viem";

export class ZeroHFAccountsNotification
  extends SDKConstruct
  implements INotification
{
  readonly #accountsCount: number;
  readonly #failedCount: number;
  readonly #badTokensStr: string;
  readonly #failedTokensStr: string;
  readonly #dedupeKey: string;

  constructor(sdk: GearboxSDK, accounts: CreditAccountData[]) {
    super(sdk);
    this.#accountsCount = accounts.length;
    this.#failedCount = accounts.filter(ca => !ca.success).length;

    const badTokens = new AddressSet();
    const failedTokens = new AddressSet();

    for (const ca of accounts) {
      for (const token of ca.tokens) {
        if (token.balance > 10n) {
          badTokens.add(token.token);
        }
        if (!token.success) {
          failedTokens.add(token.token);
        }
      }
    }

    this.#badTokensStr = badTokens
      .asArray()
      .map(t => this.sdk.tokensMeta.get(t)?.symbol ?? t)
      .join(", ");
    this.#failedTokensStr = failedTokens
      .asArray()
      .map(t => this.sdk.tokensMeta.get(t)?.symbol ?? t)
      .join(", ");
    this.#failedTokensStr =
      failedTokens.size > 0 ? `, failed tokens: ${this.#failedTokensStr}` : "";
    this.#dedupeKey = crypto
      .createHash("sha256")
      .update(badTokens.asArray().sort().join("|"))
      .digest("hex");
  }

  public messageFor(
    recipient?: Address,
  ): string | IDedupableNotification | undefined {
    if (recipient) {
      return undefined;
    }
    return {
      dedupeKey: this.#dedupeKey,
      plain: this.#plain,
      md: this.#markdown,
    };
  }

  get #plain(): string {
    return `[${this.networkType}] found ${this.#accountsCount} accounts with HF=0 (${this.#failedCount} failed), bad tokens: ${this.#badTokensStr}${this.#failedTokensStr}`;
  }

  get #markdown(): Markdown {
    return md`[${this.networkType}] found ${this.#accountsCount} accounts with HF=0 (${this.#failedCount} failed), bad tokens: ${this.#badTokensStr}${this.#failedTokensStr}`;
  }
}
