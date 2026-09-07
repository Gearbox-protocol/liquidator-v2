import type { CreditAccountData } from "@gearbox-protocol/sdk/onchain";
import LiquidationStrategyPartialBase from "./LiquidationStrategyPartialBase.js";
import type { MakeLiquidatableResult } from "./types.js";

export default class LiquidationStrategyPartial extends LiquidationStrategyPartialBase<"partial"> {
  public readonly kind = "partial" as const;

  public get name(): string {
    return "partial";
  }

  public async makeLiquidatable(
    ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult<"partial">> {
    return this.makePartialLiquidatable(ca);
  }
}
