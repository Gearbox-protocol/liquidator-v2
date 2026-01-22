import type {
  IDedupableNotification,
  INotification,
} from "@gearbox-protocol/cli-utils";
import { type GearboxSDK, hexEq, SDKConstruct } from "@gearbox-protocol/sdk";
import type { OptimisticResult } from "@gearbox-protocol/types/optimist";
import { type Markdown, md } from "@vlad-yakovlev/telegram-md";
import type { Address, TransactionReceipt } from "viem";
import prettyReceipt from "./prettyReceipt.js";

export class BatchLiquidationFinishedNotification
  extends SDKConstruct
  implements INotification
{
  readonly #liquidated: OptimisticResult[];
  readonly #notLiquidated: OptimisticResult[];
  readonly receipt: TransactionReceipt;

  constructor(
    sdk: GearboxSDK,
    receipt: TransactionReceipt,
    results: OptimisticResult<bigint>[],
  ) {
    super(sdk);
    this.receipt = receipt;
    this.#liquidated = results.filter(r => !r.isError);
    this.#notLiquidated = results.filter(r => !!r.isError);
  }

  public messageFor(
    recipient?: Address,
  ): string | IDedupableNotification | undefined {
    const liquidated = this.#filterByMarketConfigurator(
      this.#liquidated,
      recipient,
    );
    const notLiquidated = this.#filterByMarketConfigurator(
      this.#notLiquidated,
      recipient,
    );

    if (liquidated.length === 0 && notLiquidated.length === 0) {
      return undefined;
    }

    return {
      dedupeKey: `batch-finished-${this.receipt.transactionHash}`,
      plain: this.#plain(liquidated.length, notLiquidated.length),
      md: this.#markdown(liquidated.length, notLiquidated.length),
    };
  }

  #plain(liquidated: number, notLiquidated: number): string {
    if (this.receipt.status === "success") {
      if (notLiquidated === 0) {
        return `✅ [${this.networkType}] batch-liquidated ${liquidated} accounts:      
Tx receipt: ${prettyReceipt.plain(this)}
Gas used: ${this.receipt.gasUsed?.toLocaleString("en")}`;
      } else {
        return `❌ [${this.networkType}] batch-liquidated ${liquidated} accounts, but failed to liquidate ${notLiquidated} more      
Tx receipt: ${prettyReceipt.plain(this)}
Gas used: ${this.receipt.gasUsed?.toLocaleString("en")}`;
      }
    }

    return `❌ [${this.networkType}] batch-liquidate tx reverted      
Tx: ${prettyReceipt.plain(this)}`;
  }

  #markdown(liquidated: number, notLiquidated: number): Markdown {
    if (this.receipt.status === "success") {
      if (notLiquidated === 0) {
        return md`✅ [${this.networkType}] batch-liquidated ${liquidated} accounts
Tx receipt: ${prettyReceipt.md(this)}
Gas used: ${md.bold(this.receipt.gasUsed?.toLocaleString("en"))}`;
      } else {
        return md`❌ [${this.networkType}] batch-liquidated ${liquidated} accounts, but failed to liquidate ${notLiquidated} more
Tx receipt: ${prettyReceipt.md(this)}
Gas used: ${md.bold(this.receipt.gasUsed?.toLocaleString("en"))}`;
      }
    }
    return md`❌ [${this.networkType}] batch-liquidate tx reverted
Tx: ${prettyReceipt.md(this)}`;
  }

  #filterByMarketConfigurator(
    results: OptimisticResult[],
    recipient?: Address,
  ): OptimisticResult[] {
    if (!recipient) {
      return results;
    }
    return results.filter(r => {
      const market = this.sdk.marketRegister.findByCreditManager(
        r.creditManager,
      );
      return hexEq(recipient, market.configurator.address);
    });
  }
}
