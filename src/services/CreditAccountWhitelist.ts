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
    return this.has(ca.creditAccount) ?? this.has(ca.creditManager);
  }
}
