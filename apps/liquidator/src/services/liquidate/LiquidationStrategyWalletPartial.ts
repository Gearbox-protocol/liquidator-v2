import type { WalletPartialStrategyPreview } from "@gearbox-protocol/liquidator-v2-config";
import type { CreditAccountData } from "@gearbox-protocol/sdk/onchain";
import { BaseError } from "viem";
import LiquidationStrategyWalletBase from "./LiquidationStrategyWalletBase.js";
import { OptimisticLTs } from "./OptimisticLTs.js";
import type { MakeLiquidatableResult } from "./types.js";

/**
 * Partially liquidates a credit account with the liquidator's own funds: part
 * of the debt is repaid in underlying in exchange for discounted collateral
 * sent to the liquidator wallet, via the credit facade directly.
 */
export default class LiquidationStrategyWalletPartial extends LiquidationStrategyWalletBase<"wallet-partial"> {
  public readonly kind = "wallet-partial" as const;

  public readonly name = "wallet-partial";

  #lts = new OptimisticLTs();

  public async makeLiquidatable(
    ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult<"wallet-partial">> {
    return this.#lts.lower(ca, 9990n);
  }

  public async preview(
    ca: CreditAccountData,
  ): Promise<WalletPartialStrategyPreview<bigint>> {
    const liquidator = this.client.address;
    const ignoreReservePrices = !this.config.updateReservePrices;
    this.#lts.apply(ca);
    try {
      const details = await this.sdk.liquidations.getPartialLiquidationDetails({
        creditAccount: ca.creditAccount,
        liquidator,
        ignoreReservePrices,
      });
      if (!details.isPartiallyLiquidatable) {
        throw new Error("warning: account cannot be partially liquidated");
      }
      this.assertLiquidatorEligible(details);
      const rawTx = await this.sdk.liquidations.buildPartialLiquidationTx({
        creditAccount: ca.creditAccount,
        liquidator,
        ignoreReservePrices,
      });
      const [seized] = details.receivedAssets;
      return {
        ...this.walletPreview(details, rawTx),
        assetOut: seized.token.address,
        amountOut: seized.value,
        repaidAmount: details.repaymentAmount.value,
        estimatedProfit: details.estimatedProfit.value,
      };
    } catch (e) {
      throw new BaseError("cant preview partial wallet liquidation", {
        cause: e as Error,
      });
    } finally {
      this.#lts.revert(ca);
    }
  }
}
