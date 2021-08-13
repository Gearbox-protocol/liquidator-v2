import {
  CreditAccountDataExtended,
  CreditAccountDataExtendedPayload,
  PERCENTAGE_FACTOR,
} from "@diesellabs/gearbox-sdk";
import { BigNumber } from "ethers";
import { TokenService } from "../services/tokenService";
import { Container } from "typedi";
import { OracleService } from "../services/oracleService";

export class CreditAccount extends CreditAccountDataExtended {
  protected readonly tokenService: TokenService;
  protected readonly oracleService: OracleService;
  protected readonly decimals: number;

  constructor(payload: CreditAccountDataExtendedPayload) {
    super(payload);
    this.tokenService = Container.get(TokenService);
    this.oracleService = Container.get(OracleService);
    this.decimals = this.tokenService.decimals(this.underlyingToken);
  }

  calcBorrowAmountPlusInterestRate(
    currentCumulativeIndex: BigNumber
  ): BigNumber {
    return this.borrowedAmount
      .mul(currentCumulativeIndex)
      .div(this.cumulativeIndexAtOpen);
  }

  calcThresholdTotalValue(liquidationThresholds: Record<string, number>) {
    return this.allowedTokens
      .map((token, num) =>
        this.oracleService
          .convert(this.balances[token], token, this.underlyingToken)
          .mul(liquidationThresholds[token])
          .div(PERCENTAGE_FACTOR)
      )
      .reduce((a, b) => a.add(b));
  }

  calcHealthFactor(
    liquidationThresholds: Record<string, number>,
    currentCumulativeIndex: BigNumber
  ): number {
    this.healthFactor =
      this.calcThresholdTotalValue(liquidationThresholds)
        .mul(PERCENTAGE_FACTOR)
        .div(this.calcBorrowAmountPlusInterestRate(currentCumulativeIndex))
        .toNumber() / PERCENTAGE_FACTOR;

    console.log(
      this.healthFactor
    );
    return this.healthFactor;
  }
}
