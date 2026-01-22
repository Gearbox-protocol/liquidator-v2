import type {
  IDedupableNotification,
  INotification,
} from "@gearbox-protocol/cli-utils";
import { type Markdown, md } from "@vlad-yakovlev/telegram-md";
import type { Address } from "viem";
import AccountNotification from "./AccountNotification.js";

export class LiquidationStartNotification
  extends AccountNotification
  implements INotification
{
  public messageFor(
    recipient?: Address,
  ): string | IDedupableNotification | undefined {
    if (!this.forMarketConfigurator(recipient)) {
      return undefined;
    }

    return {
      dedupeKey: `start-${this.ca.creditAccount.toLowerCase()}`,
      plain: this.#plain,
      md: this.#markdown,
    };
  }

  get #plain(): string {
    return `[${this.networkType}] begin liquidation of ${this.caPlain} ${this.withHF} in ${this.cmPlain}`;
  }

  get #markdown(): Markdown {
    return md`[${this.networkType}] begin liquidation of ${this.caMd} ${this.withHF} in credit manager ${this.cmMd}`;
  }
}
