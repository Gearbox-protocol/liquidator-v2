import { Whitelist } from "@gearbox-protocol/cli-utils";
import type { CreditAccountData } from "@gearbox-protocol/sdk";

export type WhitelistItem = NonNullable<ReturnType<Whitelist["has"]>>;

export class CreditAccountWhitelist extends Whitelist {
  /**
   * Returns the whitelist entry matched against either the credit account
   * address or its owning credit manager address, or `undefined` if neither
   * is whitelisted.
   */
  public match(ca: CreditAccountData): WhitelistItem | undefined {
    if (this.has(ca.creditAccount)) {
      return this.has(ca.creditAccount);
    }
    if (this.has(ca.creditManager)) {
      return this.has(ca.creditManager);
    }
    for (const t of ca.tokens) {
      if (t.balance > 1n && this.has(t.token)) {
        return this.has(t.token);
      }
    }
    return undefined;
  }
}
