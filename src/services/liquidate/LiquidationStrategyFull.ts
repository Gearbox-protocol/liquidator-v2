import type { CreditAccountData } from "@gearbox-protocol/sdk";
import LiquidationStrategyFullBase from "./LiquidationStrategyFullBase.js";
import type { MakeLiquidatableResult } from "./types.js";

export default class LiquidationStrategyFull extends LiquidationStrategyFullBase {
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
  ): Promise<MakeLiquidatableResult> {
    // is handled on optimistic runner level (zero-lt script)
    return { account: ca };
  }
}
