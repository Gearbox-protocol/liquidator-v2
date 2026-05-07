import {
  type CreditAccountData,
  PERCENTAGE_FACTOR,
} from "@gearbox-protocol/sdk";
import {
  iCreditManagerV310Abi,
  iPoolV310Abi,
} from "@gearbox-protocol/sdk/abi/310/generated";
import { replaceStorage } from "@gearbox-protocol/sdk/dev";
import LiquidationStrategyFullBase from "./LiquidationStrategyFullBase.js";
import type { MakeLiquidatableResult } from "./types.js";

export default class LiquidationStrategyLossPolicy extends LiquidationStrategyFullBase {
  protected readonly applyLossPolicy = true;

  constructor(name = "loss policy") {
    super(name);
  }

  public isApplicable(ca: CreditAccountData, optimistic: boolean): boolean {
    const cm = this.sdk.marketRegister.findCreditManager(ca.creditManager);
    const meta = this.sdk.tokensMeta.mustGet(cm.underlying);
    if (this.sdk.tokensMeta.isRWAUnderlying(meta)) {
      return false;
    }
    // In optimistic mode, makeLiquidatable will always create bad debt
    return optimistic ? true : this.hasBadDebt(ca);
  }

  public async makeLiquidatable(
    ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult> {
    const { totalValue, debt, accruedInterest } = ca;

    // Induce bad debt on account
    // see hasBadDebt for the formula
    const cs = this.sdk.marketRegister.findCreditManager(ca.creditManager);
    const discount = BigInt(cs.creditManager.liquidationDiscount);
    let increaseBy =
      (totalValue * discount) / PERCENTAGE_FACTOR - accruedInterest - debt;
    if (increaseBy < 0n) {
      // already has bad debt, nothing to do
      return { account: ca };
    }
    increaseBy = (105n * increaseBy) / 100n;
    const newDebt = debt + increaseBy;

    const by = this.sdk.tokensMeta.formatBN(cs.underlying, increaseBy, {
      symbol: true,
    });
    const to = this.sdk.tokensMeta.formatBN(cs.underlying, newDebt, {
      symbol: true,
    });
    this.logger.debug(`artificially increasing debt by ${by} to ${to}`);
    const snapshotId = await this.client.anvil.snapshot();

    await this.#setDebt(ca, increaseBy, newDebt);
    const account = await this.sdk.accounts.getCreditAccountData(
      ca.creditAccount,
    );
    if (!account || !this.hasBadDebt(account)) {
      throw new Error("could not induce bad debt");
    }

    return {
      account,
      snapshotId,
    };
  }

  async #setDebt(
    ca_: CreditAccountData,
    increaseBy: bigint,
    newDebt: bigint,
  ): Promise<void> {
    const { creditAccount, creditManager } = ca_;
    const { pool } = this.sdk.marketRegister.findByCreditManager(creditManager);
    await replaceStorage(this.client.anvil, {
      address: creditManager,
      abi: iCreditManagerV310Abi,
      functionName: "creditAccountInfo",
      args: [creditAccount],
      value: newDebt,
      slotMatch: (readVal, newVal) => readVal[0] === newVal,
    });
    const newTotalBorrowed = pool.pool.totalBorrowed + increaseBy;
    await replaceStorage(this.client.anvil, {
      address: pool.pool.address,
      abi: iPoolV310Abi,
      functionName: "totalBorrowed",
      args: [],
      value: newTotalBorrowed,
      slotMatch: (readVal, newVal) => readVal === newVal,
    });
    const newManagerBorrowed =
      pool.pool.creditManagerDebtParams.mustGet(creditManager).borrowed +
      increaseBy;
    await replaceStorage(this.client.anvil, {
      address: pool.pool.address,
      abi: iPoolV310Abi,
      functionName: "creditManagerBorrowed",
      args: [creditManager],
      value: newManagerBorrowed,
      slotMatch: (readVal, newVal) => readVal === newVal,
    });
  }
}
