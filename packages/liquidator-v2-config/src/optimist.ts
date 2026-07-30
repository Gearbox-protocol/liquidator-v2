import type { MultiCall, PriceUpdate, RawTx } from "@gearbox-protocol/sdk";
import type { Address } from "viem";

export type Numberish = number | string | bigint;

/**
 * Discriminator for the liquidation strategy that produced an {@link OptimisticResult}.
 * `none` is used when no strategy was applicable, or an error occurred before a
 * strategy could be selected.
 */
export type LiquidationStrategyKind =
  | "full"
  | "loss-policy"
  | "rwa-via-stablecoins"
  | "partial"
  | "deleverage"
  | "wallet"
  | "none";

/**
 * Preview data shared by full and loss-policy strategies (single full liquidation
 * routed through the pathfinder). Carries the execution-only fields (`calls`,
 * `rawTx`, `skipOnFailure`) used to build and send the liquidation tx; these are
 * stored as-is in {@link OptimisticResult}.
 */
export interface FullStrategyPreview<N extends Numberish = Numberish> {
  /**
   * Router's pre-tx estimate (`routerCloseResult.underlyingBalance`) of how much
   * underlying the account holds after all non-underlying collateral is swapped to
   * underlying: existing underlying plus the amount received from swaps.
   */
  routerAmount: N;
  /**
   * Minimum acceptable underlying amount out after applying slippage.
   */
  minAmount?: N;
  /**
   * Multicalls used to liquidate the account.
   */
  calls: readonly MultiCall[];
  /**
   * Raw liquidation transaction produced by the pathfinder.
   */
  rawTx: RawTx;
  /**
   * If true, will not attempt to liquidate this account again.
   */
  skipOnFailure?: boolean;
}

/**
 * Preview data shared by partial and deleverage strategies. Carries the
 * execution-only fields (`calls`, `priceUpdates`, `skipOnFailure`) used to build
 * and send the liquidation tx; these are stored as-is in {@link OptimisticResult}.
 */
export interface PartialStrategyPreview<N extends Numberish = Numberish> {
  /**
   * Token taken out of the account in exchange for repaying part of the debt.
   */
  assetOut: Address;
  /**
   * Amount of {@link assetOut} taken out of the account.
   */
  amountOut: N;
  /**
   * Flash loan amount used to repay the debt during partial liquidation.
   */
  flashLoanAmount: N;
  /**
   * Partial-liquidator contract's previewed profit in underlying token
   * (`previewPartialLiquidation().profit`).
   */
  previewedProfit: N;
  /**
   * On-demand (redstone) price updates included in the liquidation call.
   */
  priceUpdates: PriceUpdate[];
  /**
   * Multicalls used to liquidate the account.
   */
  calls: readonly MultiCall[];
  /**
   * If true, will not attempt to liquidate this account again.
   */
  skipOnFailure?: boolean;
}

export interface RwaStrategyPreview {
  /**
   * Securitize redemption gateway used during liquidation.
   */
  redemptionGateway: Address;
  /**
   * On-demand (redstone) price updates included in the liquidation call.
   */
  priceUpdates: PriceUpdate[];
  /**
   * Multicalls used to liquidate the account.
   */
  calls: readonly MultiCall[];
  /**
   * If true, will not attempt to liquidate this account again.
   */
  skipOnFailure?: boolean;
}

/**
 * ERC-20 approval the liquidator must grant before sending the liquidation
 * transaction when it pays from its own funds.
 */
export interface Approval<N extends Numberish = Numberish> {
  /**
   * Credit manager, or the dedicated Midas/Securitize liquidator contract.
   */
  spender: Address;
  /**
   * Credit manager underlying.
   */
  token: Address;
  /**
   * Amount the liquidation pulls plus the SDK's headroom.
   */
  amount: N;
}

/**
 * Delayed withdrawal position the liquidator takes ownership of during
 * liquidation. No tokens move: the redeemer contract changes owner.
 */
export interface Redeemer<N extends Numberish = Numberish> {
  /**
   * Redeemer contract whose ownership moves to the liquidator.
   */
  address?: Address;
  /**
   * Receivable token, e.g. the Securitize stablecoin.
   */
  token: Address;
  /**
   * Amount of {@link token}: exact for claimable withdrawals, estimated for
   * pending ones.
   */
  amount: N;
  /**
   * Estimated unix timestamp (seconds) when the redemption becomes claimable.
   */
  claimableAt?: N;
}

/**
 * Preview data of the wallet strategy: a liquidation paid from the liquidator's
 * own funds, previewed by the liquidation compressor.
 */
export interface WalletStrategyPreview<N extends Numberish = Numberish> {
  /**
   * Approval granted in the prepare step, absent when the liquidation path
   * needs no capital from the liquidator.
   */
  approve?: Approval<N>;
  /**
   * Redemption positions the liquidation hands over to the liquidator.
   */
  redeemers: Redeemer<N>[];
  /**
   * Multicalls used to liquidate the account, decoded from the compressor's
   * calldata when it targets the credit facade, empty otherwise.
   */
  calls: readonly MultiCall[];
  /**
   * Liquidation transaction built by the liquidation compressor.
   */
  rawTx: RawTx;
  /**
   * If true, will not attempt to liquidate this account again.
   */
  skipOnFailure?: boolean;
}

/**
 * Token amount reported in an {@link OptimisticResult}.
 */
export interface OptimisticAsset<N extends Numberish = Numberish> {
  token: Address;
  amount: N;
}

/**
 * What the liquidator got out of a wallet-funded liquidation.
 */
export interface WalletStrategyOutcome<N extends Numberish = Numberish> {
  /**
   * Balance increases of the liquidator wallet across the liquidation,
   * measured with a `balanceOf` multicall before and after the transaction.
   * Includes phantom tokens such as Securitize pending redemptions.
   */
  received: OptimisticAsset<N>[];
  /**
   * Redemption positions the liquidator now owns, from the compressor preview:
   * the redeemer addresses and claim timestamps that a balance cannot express.
   */
  redeemers: Redeemer<N>[];
}

export interface LossPolicyStrategySetup<N extends Numberish = Numberish> {
  /**
   * Amount the account debt was artificially increased by.
   */
  inducedDebtIncrease: N;
  /**
   * Resulting account debt after the artificial increase.
   */
  newDebt: N;
}

export interface PartialStrategySetup<N extends Numberish = Numberish> {
  /**
   * Mapping token address -> [old LT, new LT]
   */
  ltChanges?: Record<Address, [ltOld: N, ltNew: N]> | null;
  /**
   * Account health factor after changing LTs
   */
  hfNew: N;
}

export interface DeleverageStrategySetup<N extends Numberish = Numberish>
  extends PartialStrategySetup<N> {
  /**
   * True when deleverage bot permissions were force-enabled on the account
   * (false when relying on the production scanner).
   */
  botForceEnabled: boolean;
}

export interface RwaStrategySetup {
  /**
   * Securitize redemption gateway used to redeem the RWA collateral.
   */
  redemptionGateway: Address;
  /**
   * Investor account that owns the RWA position being redeemed.
   */
  investor?: Address;
}

/**
 * Maps each {@link LiquidationStrategyKind} to its preview shape.
 * `none` has no preview.
 */
export interface StrategyPreviews<N extends Numberish = Numberish> {
  full: FullStrategyPreview<N>;
  "loss-policy": FullStrategyPreview<N>;
  partial: PartialStrategyPreview<N>;
  deleverage: PartialStrategyPreview<N>;
  "rwa-via-stablecoins": RwaStrategyPreview;
  wallet: WalletStrategyPreview<N>;
  none: never;
}

/**
 * Maps each {@link LiquidationStrategyKind} to its `outcome` shape (what the
 * liquidator got out of the liquidation). Only strategies that liquidate with
 * own capital report one.
 */
export interface StrategyOutcomes<N extends Numberish = Numberish> {
  full: never;
  "loss-policy": never;
  partial: never;
  deleverage: never;
  "rwa-via-stablecoins": never;
  wallet: WalletStrategyOutcome<N>;
  none: never;
}

/**
 * Maps each {@link LiquidationStrategyKind} to its `setup` shape (how the account
 * was made liquidatable). `full`/`none` have no setup.
 */
export interface StrategySetups<N extends Numberish = Numberish> {
  full: never;
  "loss-policy": LossPolicyStrategySetup<N>;
  partial: PartialStrategySetup<N>;
  deleverage: DeleverageStrategySetup<N>;
  "rwa-via-stablecoins": RwaStrategySetup;
  wallet: never;
  none: never;
}

/**
 * Fields shared by every {@link OptimisticResult}, independent of strategy.
 */
export interface OptimisticResultBase<N extends Numberish = Numberish> {
  /**
   * Credit Manager address
   */
  creditManager: Address;
  /**
   * Borrower address
   */
  borrower: Address;
  /**
   * Credit account address
   */
  account: Address;
  /**
   * Gas used for liquidation from tx recepit
   */
  gasUsed: N;
  /**
   * Multicalls used as parameter in liquidateCreditAccount function
   * Can be null or undfined in case of error
   */
  calls?: MultiCall[] | null;
  /**
   * Realized change in the premium receiver's underlying token balance across the
   * liquidation tx (`underlyingAfter - underlyingBefore`). This is the underlying
   * the liquidator actually pocketed. Measured (not estimated).
   */
  liquidatorPremium: N;
  /**
   * Native token (ETH) spent by the executor across the real liquidation tx
   * (`ethBefore - ethAfter`), stored as a positive value. In practice this is the
   * gas paid, since the liquidation premium is received in the underlying token
   * rather than in native token (no underlying->native swap happens here).
   */
  gasCost: N;
  /**
   * True if errors accrued
   */
  isError: boolean;
  /**
   * How much time it took to liquidate this account (ms)
   */
  duration?: number;
  /**
   * Parsed version of calls
   * Reason why we do it here is that parser is available in gearbox SDK only, which uses ethers-5 and cannot be imported in other places
   * This field is not available in all the liquidators
   */
  callsHuman?: string[] | null;
  /**
   * Token balances before liquidation
   */
  balancesBefore: Record<Address, N>;
  /**
   * Token after (partial) liquidation
   */
  balancesAfter: Record<Address, N>;
  /**
   * Health factor before liquidation
   */
  hfBefore: N;
  /**
   * Health factor after (partial) liquidation
   */
  hfAfter: N;
  /**
   * Error occured during liquidation
   */
  error?: string;
  /**
   * In case of error, cast call --trace ansii file name
   */
  traceFile?: string;
  /**
   * In case when account are liquidated in batches
   */
  batchId?: string;
  /**
   * Track identifier. Defaults to the strategy kind in the liquidator; the
   * optimistic runner (apps/optimist) overwrites it with the actual track id,
   * so several tracks can share one strategy.
   */
  trackId: string;
}

type OptimisticResultByKind<N extends Numberish = Numberish> = {
  [K in LiquidationStrategyKind]: OptimisticResultBase<N> & {
    /**
     * Strategy that produced this result.
     */
    strategy: K;
    /**
     * Strategy-specific setup that made the account liquidatable.
     */
    setup?: StrategySetups<N>[K];
    /**
     * Strategy-specific liquidation preview.
     */
    preview?: StrategyPreviews<N>[K];
    /**
     * Strategy-specific result of the liquidation: what the liquidator got.
     */
    outcome?: StrategyOutcomes<N>[K];
  };
};

/**
 * Optimistic liquidation result format, shared by all liquidators.
 *
 * With the default `K` this is a discriminated union over `strategy`, so narrowing
 * on `result.strategy` refines `setup`/`preview`. Pass a concrete `K` (e.g.
 * `OptimisticResult<bigint, "partial">`) to pin one variant.
 */
export type OptimisticResult<
  N extends Numberish = Numberish,
  K extends LiquidationStrategyKind = LiquidationStrategyKind,
> = OptimisticResultByKind<N>[K];
