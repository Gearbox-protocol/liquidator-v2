import type { WalletStrategyPreview } from "@gearbox-protocol/liquidator-v2-config";
import type { CreditAccountData } from "@gearbox-protocol/sdk/onchain";
import { BaseError } from "viem";
import LiquidationStrategyWalletBase from "./LiquidationStrategyWalletBase.js";
import type { MakeLiquidatableResult } from "./types.js";

/**
 * Liquidates a credit account with the liquidator's own funds: the debt is
 * repaid in underlying and all the account collateral is received by the
 * liquidator wallet.
 *
 * Applies to every account, RWA or not: the liquidation compressor picks the
 * path (credit facade directly, or a dedicated Midas/Securitize liquidator
 * contract).
 */
export default class LiquidationStrategyWalletFull extends LiquidationStrategyWalletBase<"wallet-full"> {
  public readonly kind = "wallet-full" as const;

  public readonly name = "wallet-full";

  /**
   * Registers the dedicated Midas/Securitize liquidator contracts in the sdk,
   * so that the compressor's calldata targeting them can be stringified.
   */
  public override async launch(): Promise<void> {
    await this.sdk.liquidations.loadRWALiquidators();
  }

  public async makeLiquidatable(
    ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult<"wallet-full">> {
    // is handled on optimistic runner level (funding, kyc and zero-lt scripts)
    return { account: ca };
  }

  public async preview(
    ca: CreditAccountData,
  ): Promise<WalletStrategyPreview<bigint>> {
    const liquidator = this.client.address;
    const ignoreReservePrices = !this.config.updateReservePrices;
    try {
      const details = await this.sdk.liquidations.getLiquidationDetails({
        creditAccount: ca.creditAccount,
        liquidator,
        ignoreReservePrices,
      });
      this.assertLiquidatorEligible(details);
      const rawTx = await this.sdk.liquidations.buildLiquidationTx({
        creditAccount: ca.creditAccount,
        liquidator,
        ignoreReservePrices,
      });
      return this.walletPreview(details, rawTx);
    } catch (e) {
      throw new BaseError("cant preview wallet liquidation", {
        cause: e as Error,
      });
    }
  }
}
