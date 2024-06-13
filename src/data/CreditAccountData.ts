import {
  PERCENTAGE_DECIMALS,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk-gov";
import type { Address } from "viem";

import {
  type Arrayish,
  json_stringify,
  type Numberish,
} from "../utils/index.js";

export interface TokenBalanceRaw {
  token: string;
  balance: Numberish;
  isForbidden: boolean;
  isEnabled: boolean;
  isQuoted: boolean;
  quota: Numberish;
  quotaRate: Numberish;
  quotaCumulativeIndexLU: Numberish;
}

export interface CreditAccountDataRaw {
  isSuccessful: boolean;
  priceFeedsNeeded: Arrayish<string>;
  addr: string;
  borrower: string;
  creditManager: string;
  cmName: string;
  creditFacade: string;
  underlying: string;
  debt: Numberish;
  cumulativeIndexLastUpdate: Numberish;
  cumulativeQuotaInterest: Numberish;
  accruedInterest: Numberish;
  accruedFees: Numberish;
  totalDebtUSD: Numberish;
  totalValue: Numberish;
  totalValueUSD: Numberish;
  twvUSD: Numberish;
  enabledTokensMask: Numberish;
  healthFactor: Numberish;
  baseBorrowRate: Numberish;
  aggregatedBorrowRate: Numberish;
  balances: Arrayish<TokenBalanceRaw>;
  since: Numberish;
  cfVersion: Numberish;
  expirationDate: Numberish;
}

export interface TokenBalance {
  token: Address;
  balance: bigint;
  isForbidden: boolean;
  isEnabled: boolean;
  isQuoted: boolean;
  quota: bigint;
  quotaRate: bigint;
  quotaCumulativeIndexLU: bigint;
}

export class CreditAccountData {
  readonly isSuccessful: boolean;
  readonly priceFeedsNeeded: Address[];

  readonly addr: Address;
  readonly borrower: Address;
  readonly creditManager: Address;
  readonly creditFacade: Address;
  readonly underlyingToken: Address;
  readonly since: number;
  readonly expirationDate: number;
  readonly version: number;
  readonly cmName: string;

  readonly enabledTokenMask: bigint;
  readonly healthFactor: number;
  isDeleting: boolean;

  readonly borrowedAmount: bigint;
  readonly accruedInterest: bigint;
  readonly accruedFees: bigint;
  readonly totalDebtUSD: bigint;
  readonly borrowedAmountPlusInterestAndFees: bigint;
  readonly totalValue: bigint;
  readonly totalValueUSD: bigint;
  readonly twvUSD: bigint;

  readonly cumulativeIndexLastUpdate: bigint;
  readonly cumulativeQuotaInterest: bigint;

  readonly balances: Record<Address, bigint> = {};
  readonly collateralTokens: Address[] = [];
  readonly allBalances: TokenBalance[] = [];

  constructor(payload: CreditAccountDataRaw) {
    console.log(
      json_stringify({
        payload,
        pf: payload.priceFeedsNeeded,
        pfType: typeof payload.priceFeedsNeeded,
      }),
    );
    this.isSuccessful = payload.isSuccessful;
    this.priceFeedsNeeded = [...payload.priceFeedsNeeded] as Address[];

    this.addr = payload.addr.toLowerCase() as Address;
    this.borrower = payload.borrower.toLowerCase() as Address;
    this.creditManager = payload.creditManager.toLowerCase() as Address;
    this.creditFacade = payload.creditFacade.toLowerCase() as Address;
    this.underlyingToken = payload.underlying.toLowerCase() as Address;
    this.since = Number(payload.since);
    this.expirationDate = Number(payload.expirationDate);
    this.version = Number(payload.cfVersion);
    this.cmName = payload.cmName;

    this.healthFactor = Number(payload.healthFactor || 0n);
    this.enabledTokenMask = BigInt(payload.enabledTokensMask);
    this.isDeleting = false;

    this.borrowedAmount = BigInt(payload.debt);
    this.accruedInterest = BigInt(payload.accruedInterest || 0n);
    this.accruedFees = BigInt(payload.accruedFees || 0n);
    this.borrowedAmountPlusInterestAndFees =
      this.borrowedAmount + this.accruedInterest + this.accruedFees;
    this.totalDebtUSD = BigInt(payload.totalDebtUSD);
    this.totalValue = BigInt(payload.totalValue || 0n);
    this.totalValueUSD = BigInt(payload.totalValueUSD);
    this.twvUSD = BigInt(payload.twvUSD);

    this.cumulativeIndexLastUpdate = BigInt(payload.cumulativeIndexLastUpdate);
    this.cumulativeQuotaInterest = BigInt(payload.cumulativeQuotaInterest);

    payload.balances.forEach(b => {
      const token = b.token.toLowerCase() as Address;
      const balance: TokenBalance = {
        token,
        balance: BigInt(b.balance),
        isForbidden: b.isForbidden,
        isEnabled: b.isEnabled,
        isQuoted: b.isQuoted,
        quota: BigInt(b.quota),
        quotaRate: BigInt(b.quotaRate) * PERCENTAGE_DECIMALS,
        quotaCumulativeIndexLU: BigInt(b.quotaCumulativeIndexLU),
      };

      if (!b.isForbidden) {
        this.balances[token] = balance.balance;
        this.collateralTokens.push(token);
      }

      this.allBalances.push(balance);
    });
  }

  public get name(): string {
    return `${this.addr} of ${this.borrower} in ${this.managerName})`;
  }

  public get managerName(): string {
    const cmSymbol = tokenSymbolByAddress[this.underlyingToken];
    return this.cmName || `${this.creditManager} (${cmSymbol})`;
  }

  public filterDust(): Record<Address, bigint> {
    const result: Record<Address, bigint> = {};
    for (const { token, balance } of this.allBalances) {
      if (balance > 10n) {
        result[token] = balance;
      }
    }
    return result;
  }
}
