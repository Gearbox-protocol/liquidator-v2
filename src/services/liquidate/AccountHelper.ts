import {
  type CreditAccountData,
  type GearboxSDK,
  PERCENTAGE_FACTOR,
} from "@gearbox-protocol/sdk";
import type { ILogger } from "../../log/index.js";

export default abstract class AccountHelper {
  protected abstract sdk: GearboxSDK;
  public abstract logger: ILogger;

  /**
   * Whether account's total value (minus liquidator's premium) is below its outstanding debt
   * @see https://github.com/Gearbox-protocol/core-v3/blob/5144d61af7d117f86d3fa9b4e2aa05535e2e5433/contracts/credit/CreditFacadeV3.sol#L986-L990
   * @param ca
   * @returns
   */
  protected hasBadDebt(ca: CreditAccountData): boolean {
    const { creditManager } = this.sdk.marketRegister.findCreditManager(
      ca.creditManager,
    );
    return (
      ca.totalValue * BigInt(creditManager.liquidationDiscount) <
      (ca.debt + ca.accruedInterest) * PERCENTAGE_FACTOR
    );
  }
}
