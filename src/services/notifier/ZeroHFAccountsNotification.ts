import crypto from "node:crypto";
import type {
  IDedupableNotification,
  INotification,
} from "@gearbox-protocol/cli-utils";
import {
  AddressSet,
  type CreditAccountData,
  type OnchainSDK,
  SDKConstruct,
} from "@gearbox-protocol/sdk";
import { type Markdown, md } from "@vlad-yakovlev/telegram-md";
import type { Address } from "viem";

const MAX_ACCS = 3;

export class ZeroHFAccountsNotification
  extends SDKConstruct
  implements INotification
{
  readonly #accountsCount: number;
  readonly #failedCount: number;
  readonly #badTokensStr: string;
  readonly #failedTokensStr: string;
  readonly #dedupeKey: string;
  readonly #failedPools: string;
  readonly #blockNumber: bigint;
  readonly #accounts: Address[];

  constructor(
    sdk: OnchainSDK,
    accounts: CreditAccountData[],
    blockNumber?: bigint,
  ) {
    super(sdk);
    this.#accountsCount = accounts.length;
    this.#failedCount = accounts.filter(ca => !ca.success).length;
    this.#blockNumber = blockNumber ?? sdk.currentBlock;

    const badTokens = new AddressSet();
    const failedTokens = new AddressSet();
    const pools = new AddressSet();

    for (const ca of accounts) {
      for (const token of ca.tokens) {
        if (token.balance > 10n) {
          badTokens.add(token.token);
        }
        if (!token.success) {
          failedTokens.add(token.token);
        }
      }
      pools.add(
        this.sdk.marketRegister.findByCreditManager(ca.creditManager).pool.pool
          .address,
      );
    }

    this.#badTokensStr = badTokens
      .asArray()
      .map(t => this.sdk.tokensMeta.get(t)?.symbol ?? t)
      .join(", ");
    this.#failedTokensStr = failedTokens
      .asArray()
      .map(t => this.sdk.tokensMeta.get(t)?.symbol ?? t)
      .join(", ");
    this.#failedPools = pools
      .asArray()
      .map(p => this.sdk.labelAddress(p))
      .join(", ");

    this.#accounts = accounts.map(ca => ca.creditAccount);
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
    const accountsStr =
      this.#accounts.length <= MAX_ACCS
        ? this.#accounts.join(", ")
        : [
            ...this.#accounts.slice(0, MAX_ACCS),
            `and ${this.#accounts.length - MAX_ACCS} more...`,
          ].join(", ");
    return `[${this.networkType}][block ${this.#blockNumber}] found ${this.#failedCount} failed accounts (${this.#accounts} with HF=0): ${accountsStr} — pools: ${this.#failedPools}, bad tokens: ${this.#badTokensStr}${this.#failedTokensStr}`;
  }

  get #markdown(): Markdown {
    const accountsMd =
      this.#accounts.length <= MAX_ACCS
        ? md.join(
            this.#accounts.map(a => md.inlineCode(a)),
            ", ",
          )
        : md.join(
            [
              ...this.#accounts.slice(0, MAX_ACCS).map(a => md.inlineCode(a)),
              md`and ${this.#accounts.length - MAX_ACCS} more...`,
            ],
            ",",
          );
    return md`[${this.networkType}][block ${md.inlineCode(this.#blockNumber.toString(10))}] found ${this.#failedCount} failed accounts (${this.#accountsCount} with HF=0): ${accountsMd} — pools: ${this.#failedPools}, bad tokens: ${this.#badTokensStr}${this.#failedTokensStr}`;
  }
}
