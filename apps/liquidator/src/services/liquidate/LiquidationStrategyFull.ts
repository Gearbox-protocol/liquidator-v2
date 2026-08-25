import type { CreditAccountData } from "@gearbox-protocol/sdk/onchain";
import LiquidationStrategyFullBase from "./LiquidationStrategyFullBase.js";
import type { MakeLiquidatableResult } from "./types.js";

export default class LiquidationStrategyFull extends LiquidationStrategyFullBase<"full"> {
  public readonly kind = "full" as const;

  protected readonly applyLossPolicy = false;

  constructor(name = "full") {
    super(name);
  }

  public isApplicable(ca: CreditAccountData, _optimistic: boolean): boolean {
    const cm = this.sdk.marketRegister.findCreditManager(ca.creditManager);
    const meta = this.sdk.tokensMeta.mustGet(cm.underlying);
    return !this.sdk.tokensMeta.isRWAUnderlying(meta);
  }

  public async makeLiquidatable(
    ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult<"full">> {
    // is handled on optimistic runner level (zero-lt script)
    return { account: ca };
  }
}
