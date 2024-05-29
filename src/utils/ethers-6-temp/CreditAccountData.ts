import {
  PERCENTAGE_DECIMALS,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk-gov";
import type {
  CreditAccountData as ICreditAccountData,
  TokenBalance,
} from "@gearbox-protocol/types/v3";

export class CreditAccountData {
  readonly isSuccessful: boolean;
  readonly priceFeedsNeeded: string[];

  readonly addr: string;
  readonly borrower: string;
  readonly creditManager: string;
  readonly creditFacade: string;
  readonly underlyingToken: string;
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

  readonly activeBots: Record<string, true>;

  readonly balances: Record<string, bigint> = {};
  readonly collateralTokens: Array<string> = [];
  readonly allBalances: Record<string, TokenBalance> = {};
  readonly forbiddenTokens: Record<string, true> = {};
  readonly quotedTokens: Record<string, true> = {};

  constructor(payload: ICreditAccountData) {
    this.isSuccessful = payload.isSuccessful;
    this.priceFeedsNeeded = payload.priceFeedsNeeded;

    this.addr = payload.addr.toLowerCase();
    this.borrower = payload.borrower.toLowerCase();
    this.creditManager = payload.creditManager.toLowerCase();
    this.creditFacade = payload.creditFacade.toLowerCase();
    this.underlyingToken = payload.underlying.toLowerCase();
    this.since = Number(payload.since);
    this.expirationDate = Number(payload.expirationDate);
    this.version = Number(payload.cfVersion);
    this.cmName = payload.cmName;

    this.healthFactor = Number(payload.healthFactor || 0n);
    this.enabledTokenMask = payload.enabledTokensMask;
    this.isDeleting = false;

    this.borrowedAmount = payload.debt;
    this.accruedInterest = payload.accruedInterest || 0n;
    this.accruedFees = payload.accruedFees || 0n;
    this.borrowedAmountPlusInterestAndFees =
      this.borrowedAmount + this.accruedInterest + this.accruedFees;
    this.totalDebtUSD = payload.totalDebtUSD;
    this.totalValue = payload.totalValue || 0n;
    this.totalValueUSD = payload.totalValueUSD;
    this.twvUSD = payload.twvUSD;

    this.cumulativeIndexLastUpdate = payload.cumulativeIndexLastUpdate;
    this.cumulativeQuotaInterest = payload.cumulativeQuotaInterest;

    this.activeBots = Object.fromEntries(
      payload.activeBots.map(b => [b.toLowerCase(), true]),
    );

    payload.balances.forEach(b => {
      const token = b.token.toLowerCase();
      const balance: TokenBalance = {
        token,
        balance: b.balance,
        isForbidden: b.isForbidden,
        isEnabled: b.isEnabled,
        isQuoted: b.isQuoted,
        quota: b.quota,
        quotaRate: b.quotaRate * PERCENTAGE_DECIMALS,
        quotaCumulativeIndexLU: b.quotaCumulativeIndexLU,
      };

      if (!b.isForbidden) {
        this.balances[token] = balance.balance;
        this.collateralTokens.push(token);
      }
      if (b.isForbidden) {
        this.forbiddenTokens[token] = true;
      }
      if (b.isQuoted) {
        this.quotedTokens[token] = true;
      }

      this.allBalances[token] = balance;
    });
  }

  public get name(): string {
    return `${this.addr} of ${this.borrower} in ${this.managerName})`;
  }

  public get managerName(): string {
    const cmSymbol = tokenSymbolByAddress[this.underlyingToken];
    return this.cmName || `${this.creditManager} (${cmSymbol})`;
  }

  setDeleteInProgress(d: boolean) {
    this.isDeleting = d;
  }

  isForbidden(token: string) {
    return !!this.forbiddenTokens[token];
  }

  isQuoted(token: string) {
    return !!this.quotedTokens[token];
  }

  isTokenEnabled(token: string) {
    return this.allBalances[token].isEnabled;
  }
}
