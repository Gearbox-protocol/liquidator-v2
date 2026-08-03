import type {
  LiquidationStrategyKind,
  StrategyOutcomes,
  StrategyPreviews,
  StrategySetups,
} from "@gearbox-protocol/liquidator-v2-config";
import type { CreditAccountData } from "@gearbox-protocol/sdk";
import type { Address, Hex, TransactionReceipt } from "viem";

export interface ILiquidatorService {
  launch: () => Promise<void>;
  syncState: (blockNumber: bigint) => Promise<void>;
  liquidate: (accounts: CreditAccountData[]) => Promise<void>;
  /**
   *
   * @param ca
   * @param redstoneTokens
   * @returns true is account was successfully liquidated
   */
  liquidateOptimistic: (accounts: CreditAccountData[]) => Promise<void>;
}

/**
 * Transaction to send
 */
export interface LiquidationRequest {
  to: Address;
  data: Hex;
  value?: bigint;
}

export type MakeLiquidatableResult<
  K extends LiquidationStrategyKind = LiquidationStrategyKind,
> = {
  /**
   * Re-read after making account liquidatable
   */
  account: CreditAccountData;
  snapshotId?: Hex;
  /**
   * Strategy-specific setup that made the account liquidatable (absent for
   * strategies without setup, e.g. `full`)
   */
  setup?: StrategySetups<bigint>[K];
};

export interface ILiquidationStrategy<
  K extends LiquidationStrategyKind = LiquidationStrategyKind,
> {
  name: string;
  /**
   * Stable discriminator used to build the strategy-specific part of OptimisticResult
   */
  readonly kind: K;

  /**
   * Address that receives the liquidation premium / leftover underlying for this
   * strategy. Used to measure liquidator premium in optimistic mode.
   */
  readonly premiumReceiver: Address;

  launch: () => Promise<void>;
  syncState: (blockNumber: bigint) => Promise<void>;
  isApplicable: (ca: CreditAccountData, optimistic: boolean) => boolean;
  /**
   * For optimistic liquidations only: create conditions that make this account liquidatable
   * If strategy implements this scenario, it must make evm_snapshot beforehand and return it as a result
   * Id strategy does not support this, return undefined
   * @param ca
   * @returns evm snapshotId or underfined
   */
  makeLiquidatable: (
    ca: CreditAccountData,
  ) => Promise<MakeLiquidatableResult<K>>;

  /**
   * Gathers all data required to generate transaction that liquidates account
   * @param ca
   */
  preview: (ca: CreditAccountData) => Promise<StrategyPreviews<bigint>[K]>;
  /**
   * Writes that the liquidation depends on, sent after preview and before simulation.
   * For example, granting an ERC-20 approval when the liquidator pays from own funds.
   *
   * @param account
   * @param preview
   */
  prepare?: (
    account: CreditAccountData,
    preview: StrategyPreviews<bigint>[K],
  ) => Promise<void>;
  /**
   * Using data gathered by preview step, simulates transaction with `eth_call`.
   * Nothing is written, and gas is not estimated here: `Client` does that via
   * `prepareTransactionRequest` when the transaction is actually sent.
   * In optimistic mode, we create snapshot after that state so that all the loaded storage slots are not reverted on next account.
   *
   * Returned transaction data then can be used to send actual transaction.
   * @param account
   * @param preview
   * @returns
   */
  simulate: (
    account: CreditAccountData,
    preview: StrategyPreviews<bigint>[K],
  ) => Promise<LiquidationRequest>;
  /**
   * For optimistic liquidations only: measures what the liquidator got out of
   * the liquidation, called after a successful transaction.
   * @param account
   * @param preview
   * @param receipt
   */
  collectOutcome?: (
    account: CreditAccountData,
    preview: StrategyPreviews<bigint>[K],
    receipt: TransactionReceipt,
  ) => Promise<StrategyOutcomes<bigint>[K] | undefined>;
}
