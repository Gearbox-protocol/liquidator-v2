import crypto from "node:crypto";
import type {
  IDedupableNotification,
  INotification,
} from "@gearbox-protocol/cli-utils";
import {
  type AddressSet,
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
  readonly #badTokensStr: string;
  readonly #dedupeKey: string;

  constructor(sdk: GearboxSDK, accountsCount: number, badTokens: AddressSet) {
    super(sdk);
    this.#accountsCount = accountsCount;
    this.#badTokensStr = badTokens
      .asArray()
      .map(t => this.sdk.tokensMeta.get(t)?.symbol ?? t)
      .join(", ");
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
    return `[${this.networkType}] found ${this.#accountsCount} accounts with HF=0, bad tokens: ${this.#badTokensStr}`;
  }

  get #markdown(): Markdown {
    return md`[${this.networkType}] found ${this.#accountsCount} accounts with HF=0, bad tokens: ${this.#badTokensStr}`;
  }
}
