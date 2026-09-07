import { Whitelist, type WhitelistMode } from "@gearbox-protocol/cli-utils";
import type { CreditAccountData } from "@gearbox-protocol/sdk/onchain";

export type WhitelistItem = NonNullable<ReturnType<Whitelist["has"]>>;

export class CreditAccountWhitelist extends Whitelist {
  /**
   * Returns the whitelist entry (for the requested mode) matched against either
   * the credit account address, its owning credit manager address, or one of
   * its non-dust token balances, or `undefined` if none is whitelisted.
   */
  public match(
    ca: CreditAccountData,
    mode: WhitelistMode,
  ): WhitelistItem | undefined {
    const account = this.has(ca.creditAccount, mode);
    if (account) {
      return account;
    }
    const manager = this.has(ca.creditManager, mode);
    if (manager) {
      return manager;
    }
    for (const t of ca.tokens) {
      if (t.balance > 1n) {
        const token = this.has(t.token, mode);
        if (token) {
          return token;
        }
      }
    }
    return undefined;
  }
}
