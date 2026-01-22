import crypto from "node:crypto";
import type {
  IDedupableNotification,
  INotification,
} from "@gearbox-protocol/cli-utils";
import {
  type CreditAccountData,
  type GearboxSDK,
  hexEq,
  SDKConstruct,
} from "@gearbox-protocol/sdk";
import { type Markdown, md } from "@vlad-yakovlev/telegram-md";
import type { Address } from "viem";

export class BatchLiquidationErrorNotification
  extends SDKConstruct
  implements INotification
{
  #error: string;
  #accounts: CreditAccountData[];

  constructor(sdk: GearboxSDK, accounts: CreditAccountData[], error: string) {
    super(sdk);
    this.#accounts = accounts;
    this.#error = error.length > 128 ? `${error.slice(0, 128)}...` : error;
  }

  public messageFor(
    recipient?: Address,
  ): string | IDedupableNotification | undefined {
    const accounts = this.#filterByMarketConfigurator(
      this.#accounts,
      recipient,
    );
    if (accounts.length === 0) {
      return undefined;
    }
    return {
      dedupeKey: this.#dedupeKey(accounts),
      plain: this.#plain(accounts),
      md: this.#markdown(accounts),
    };
  }

  #plain(accounts: CreditAccountData[]): string {
    return `❌ [${this.networkType}] failed to batch-liquidate ${accounts.length} accounts      
Error: ${this.#error}`;
  }

  #markdown(accounts: CreditAccountData[]): Markdown {
    return md`❌ [${this.networkType}] failed to batch-liquidate ${accounts.length} accounts
Error: ${md.inlineCode(this.#error)}`;
  }

  #filterByMarketConfigurator(
    accounts: CreditAccountData[],
    recipient?: Address,
  ): CreditAccountData[] {
    if (!recipient) {
      return accounts;
    }
    return accounts.filter(r => {
      const market = this.sdk.marketRegister.findByCreditManager(
        r.creditManager,
      );
      return hexEq(recipient, market.configurator.address);
    });
  }

  #dedupeKey(accounts: CreditAccountData[]): string {
    const raw = accounts
      .map(a => a.creditAccount.toLowerCase())
      .sort()
      .join("|");
    return crypto.createHash("sha256").update(raw).digest("hex");
  }
}
