import type { ExecutionReport } from "@gearbox-protocol/liquidator-v2-config";
import type { CuratorName } from "@gearbox-protocol/sdk/model";
import type { Markdown } from "@vlad-yakovlev/telegram-md";
import { md } from "@vlad-yakovlev/telegram-md";
import type { Address } from "viem";
import type { INotification } from "../notifier";
import { mdList } from "../utils";
import { AbstractInstanceCheck } from "./AbstractInstanceCheck";
import type { ICheck } from "./types";

interface InvalidCM {
  name: string;
  address: Address;
  liquidationDiscount: number;
  underlyingLT: number;
}

/**
 * Checks if every credit manager has a liquidation discount greater than or equal to the underlying liquidation threshold
 *
 */
export class CheckLiquidationDiscount
  extends AbstractInstanceCheck
  implements ICheck
{
  public readonly name = "liquidation-discount";

  async check(
    _report: ExecutionReport,
    curator?: CuratorName,
  ): Promise<INotification | undefined> {
    if (curator) {
      return undefined;
    }

    const invalid: InvalidCM[] = [];
    for (const cm of this.sdk.marketRegister.creditManagers) {
      const {
        liquidationDiscount,
        underlying,
        liquidationThresholds,
        address,
      } = cm.creditManager;
      const underlyingLT = liquidationThresholds.mustGet(underlying);
      if (liquidationDiscount < underlyingLT) {
        invalid.push({
          name: cm.name,
          address,
          liquidationDiscount,
          underlyingLT,
        });
      }
    }
    if (invalid.length) {
      return new CheckLiquidationDiscountFail(invalid);
    }
  }
}

export class CheckLiquidationDiscountFail implements INotification {
  public readonly severe = true;
  public readonly invalid: InvalidCM[];

  constructor(invalid: InvalidCM[]) {
    this.invalid = invalid;
  }

  public get md(): Markdown {
    const lines = this.invalid.map(
      i =>
        md`Liquidation discount (${i.liquidationDiscount}) is less than underlying threshold (${i.underlyingLT}) credit manager ${i.name} (${md.inlineCode(i.address)})`,
    );
    return md.join(["⚠️ Liquidator premium warnings:", mdList(lines)], "\n");
  }
}
