import type {
  LiqduiatorConfig,
  OptimisticAsset,
  Redeemer,
  WalletLiquidatorSchema,
  WalletStrategyOutcome,
  WalletStrategyPreview,
} from "@gearbox-protocol/liquidator-v2-config";
import type { CreditAccountData, OnchainSDK } from "@gearbox-protocol/sdk";
import { AddressSet } from "@gearbox-protocol/sdk";
import type { Address, Hex, TransactionReceipt } from "viem";
import { BaseError, encodeFunctionData, erc20Abi } from "viem";
import { DI } from "../../di.js";
import { errorAbis } from "../../errors/index.js";
import { type ILogger, Logger } from "../../log/index.js";
import type Client from "../Client.js";
import AccountHelper from "./AccountHelper.js";
import type {
  ILiquidationStrategy,
  LiquidationRequest,
  MakeLiquidatableResult,
} from "./types.js";

/**
 * Contract type of `PoolV3_USDT`, the pool variation for USDT-style underlyings
 * with transfer fees, whose `approve` rejects overwriting a non-zero allowance.
 */
const USDT_POOL_CONTRACT_TYPE = "POOL::USDT";

/**
 * Liquidator token balances at a point in time, `balances` aligned with `tokens`.
 */
interface BalancesSnapshot {
  tokens: Address[];
  balances: bigint[];
}

/**
 * Liquidates a credit account with the liquidator's own funds: the debt is
 * repaid in underlying and all the account collateral is received by the
 * liquidator wallet.
 *
 * Applies to every account, RWA or not: the liquidation compressor picks the
 * path (credit facade directly, or a dedicated Midas/Securitize liquidator
 * contract). Unlike the other strategies, the transaction pulls underlying from
 * the liquidator, so an ERC-20 approval is granted in {@link prepare} first.
 */
export default class WalletStrategy
  extends AccountHelper
  implements ILiquidationStrategy<"wallet">
{
  @DI.Inject(DI.SDK)
  sdk!: OnchainSDK;

  @DI.Inject(DI.Config)
  config!: LiqduiatorConfig<WalletLiquidatorSchema>;

  @DI.Inject(DI.Client)
  client!: Client;

  @Logger("WalletStrategy")
  logger!: ILogger;

  public readonly kind = "wallet" as const;

  public readonly name = "wallet";

  /**
   * Liquidator balances taken in `prepare`, consumed by `collectOutcome`.
   * Optimistic mode only, where accounts are liquidated one by one.
   */
  #balancesBefore?: BalancesSnapshot;

  public get premiumReceiver(): Address {
    return this.client.address;
  }

  /**
   * Registers the dedicated Midas/Securitize liquidator contracts in the sdk,
   * so that the compressor's calldata targeting them can be stringified.
   */
  public async launch(): Promise<void> {
    await this.sdk.liquidations.loadRWALiquidators();
  }

  public async syncState(_blockNumber: bigint): Promise<void> {}

  public isApplicable(_ca: CreditAccountData, _optimistic: boolean): boolean {
    return true;
  }

  public async makeLiquidatable(
    ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult<"wallet">> {
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
      if (!details.isLiquidatorEligible) {
        const token = details.kycToken
          ? this.sdk.labelAddress(details.kycToken)
          : "liquidated assets";
        throw new Error(
          `warning: liquidator is not whitelisted in ${details.kycProtocol} for ${token}`,
        );
      }
      const rawTx = await this.sdk.liquidations.buildLiquidationTx({
        creditAccount: ca.creditAccount,
        liquidator,
        ignoreReservePrices,
      });
      const redeemers: Redeemer<bigint>[] = details.receivedAssets
        .filter(a => a.isDelayed)
        .map(a => ({
          address: a.redeemerAddress,
          token: a.token,
          amount: a.amount,
          claimableAt: a.claimableAt,
        }));
      this.logger.debug(
        {
          repayment: this.sdk.tokensMeta.formatBN(
            details.repaymentAmount.token,
            details.repaymentAmount.balance,
            { symbol: true },
          ),
          target: this.sdk.labelAddress(rawTx.to),
          approve: details.approve
            ? this.sdk.tokensMeta.formatBN(
                details.approve.token,
                details.approve.amount,
                { symbol: true },
              )
            : undefined,
          redeemers: redeemers.length,
        },
        "previewed wallet liquidation",
      );
      return {
        approve: details.approve,
        redeemers,
        calls: [{ target: rawTx.to, callData: rawTx.callData as Hex }],
        rawTx,
      };
    } catch (e) {
      throw new BaseError("cant preview wallet liquidation", {
        cause: e as Error,
      });
    }
  }

  /**
   * Grants the approval the liquidation call needs and, in optimistic mode,
   * takes the balances that `collectOutcome` diffs against.
   */
  public async prepare(
    ca: CreditAccountData,
    preview: WalletStrategyPreview<bigint>,
  ): Promise<void> {
    if (this.config.optimistic) {
      this.#balancesBefore = await this.#getBalances(ca, preview);
    }
    const { approve } = preview;
    if (!approve) {
      this.logger.debug("liquidation needs no funds from liquidator");
      return;
    }
    const { token, spender, amount } = approve;
    const [balance, allowance] = await this.client.pub.multicall({
      allowFailure: false,
      contracts: [
        {
          abi: erc20Abi,
          address: token,
          functionName: "balanceOf",
          args: [this.client.address],
        },
        {
          abi: erc20Abi,
          address: token,
          functionName: "allowance",
          args: [this.client.address, spender],
        },
      ],
    });
    if (balance < amount) {
      throw new Error(
        `warning: liquidator has ${this.sdk.tokensMeta.formatBN(token, balance, { symbol: true })}, needs ${this.sdk.tokensMeta.formatBN(token, amount, { symbol: true })}`,
      );
    }
    if (allowance >= amount) {
      this.logger.debug(
        `${this.sdk.labelAddress(spender)} is already allowed to spend ${this.sdk.tokensMeta.formatBN(token, allowance, { symbol: true })}`,
      );
      return;
    }
    if (allowance > 0n && this.#needsAllowanceReset(ca)) {
      await this.#approve(token, spender, 0n);
    }
    await this.#approve(token, spender, amount);
  }

  public async simulate(
    _account: CreditAccountData,
    preview: WalletStrategyPreview<bigint>,
  ): Promise<LiquidationRequest> {
    const { rawTx } = preview;
    const value = BigInt(rawTx.value ?? 0);
    await this.sdk.simulateCall(rawTx.to, rawTx.callData, {
      account: this.client.account,
      value,
      abis: [errorAbis],
    });
    return { to: rawTx.to, data: rawTx.callData, value };
  }

  /**
   * Measures what the liquidator received as a balance diff instead of reading
   * the receipt: phantom tokens such as securitize pending redemptions derive
   * their balance from the redemption gateway and emit no transfer events.
   */
  public async collectOutcome(
    ca: CreditAccountData,
    preview: WalletStrategyPreview<bigint>,
    _receipt: TransactionReceipt,
  ): Promise<WalletStrategyOutcome<bigint>> {
    const before = this.#balancesBefore;
    this.#balancesBefore = undefined;
    const after = await this.#getBalances(ca, preview);
    const received: OptimisticAsset<bigint>[] = [];
    if (before) {
      const balancesBefore = new Map(
        before.tokens.map((token, i) => [token, before.balances[i]]),
      );
      for (const [i, token] of after.tokens.entries()) {
        const amount = after.balances[i] - (balancesBefore.get(token) ?? 0n);
        if (amount > 0n) {
          received.push({ token, amount });
        }
      }
    }
    return { received, redeemers: preview.redeemers };
  }

  /**
   * Whether the underlying rejects changing a non-zero allowance directly:
   * markets with such an underlying use the `PoolV3_USDT` pool variation.
   */
  #needsAllowanceReset(ca: CreditAccountData): boolean {
    const { pool } = this.sdk.marketRegister.findByCreditManager(
      ca.creditManager,
    );
    return pool.pool.contractType === USDT_POOL_CONTRACT_TYPE;
  }

  async #approve(
    token: Address,
    spender: Address,
    amount: bigint,
  ): Promise<void> {
    const receipt = await this.client.sendTx({
      to: token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, amount],
      }),
    });
    this.logger.debug(
      `allowed ${this.sdk.labelAddress(spender)} to spend ${this.sdk.tokensMeta.formatBN(token, amount, { symbol: true })} in tx ${receipt.transactionHash}`,
    );
  }

  /**
   * Liquidator balances of every collateral token of the account's credit
   * manager (which includes the underlying and the phantom tokens) plus the
   * tokens of the delayed outputs.
   */
  async #getBalances(
    ca: CreditAccountData,
    preview: WalletStrategyPreview<bigint>,
  ): Promise<BalancesSnapshot> {
    const cm = this.sdk.marketRegister.findCreditManager(ca.creditManager);
    const tokenSet = new AddressSet(cm.creditManager.collateralTokens);
    for (const r of preview.redeemers) {
      tokenSet.add(r.token);
    }
    const tokens = tokenSet.asArray();
    const results = await this.client.pub.multicall({
      allowFailure: true,
      contracts: tokens.map(address => ({
        abi: erc20Abi,
        address,
        functionName: "balanceOf" as const,
        args: [this.client.address] as const,
      })),
    });
    return {
      tokens,
      balances: results.map(r => (r.status === "success" ? r.result : 0n)),
    };
  }
}
