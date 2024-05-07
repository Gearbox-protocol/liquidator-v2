import type { SupportedToken } from "@gearbox-protocol/sdk-gov";
import type {
  BalanceDeltaStructOutput,
  BalanceStructOutput,
} from "@gearbox-protocol/types/v3";
import { ICreditFacadeV3Multicall__factory } from "@gearbox-protocol/types/v3";
import type { BigNumberish } from "ethers";

import { AbstractParser } from "./abstractParser";
import type { IParser } from "./iParser";

export class CreditFacadeParser extends AbstractParser implements IParser {
  version: number;

  constructor(token: SupportedToken, version: number) {
    super(token);
    this.version = version;
    this.ifc = ICreditFacadeV3Multicall__factory.createInterface();

    this.adapterName = "CreditFacade";
  }
  parse(calldata: string): string {
    const { functionFragment, functionName } = this.parseSelector(calldata);

    switch (functionFragment.name) {
      case "addCollateral": {
        const r = this.decodeFunctionData(functionFragment, calldata);

        const token = r[0];
        const amount = r[1];

        return `${functionName}(token: ${this.tokenSymbol(
          token,
        )}, amount: ${this.formatBN(amount, this.tokenSymbol(token))})`;
      }
      case "increaseDebt":
      case "decreaseDebt": {
        const [amount] = this.decodeFunctionData(functionFragment, calldata);
        return `${functionName}(amount: ${this.formatAmount(amount)})`;
      }
      case "enableToken":
      case "disableToken": {
        const [address] = this.decodeFunctionData(functionFragment, calldata);
        return `${functionName}(token: ${this.tokenSymbol(address)})`;
      }

      case "updateQuota": {
        const [address, quotaUpdate, minQuota] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );
        return `${functionName}(token: ${this.tokenSymbol(
          address,
        )}, quotaUpdate: ${this.formatAmount(
          quotaUpdate,
        )}, minQuota: ${this.formatAmount(minQuota)})`;
      }

      case "revertIfReceivedLessThan": {
        const [balances] = this.decodeFunctionData(functionFragment, calldata);

        const balancesStr = (
          balances as Array<BalanceDeltaStructOutput | BalanceStructOutput>
        )
          .map(b => {
            const balance = "balance" in b ? b.balance : b.amount;
            const symbol = this.tokenSymbol(b.token);

            return `${symbol}: ${this.formatBN(balance, symbol)}`;
          })
          .join(", ");

        return `${functionName}(${balancesStr})`;
      }

      case "withdrawCollateral": {
        const [token, amount, to] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );

        return `${functionName}(token: ${this.tokenSymbol(
          token,
        )}, withdraw: ${this.formatBN(
          amount,
          this.tokenSymbol(token),
        )}, to: ${to})`;
      }

      case "addCollateralWithPermit": {
        const [tokenAddress, amount, deadline, v, r, s] =
          this.decodeFunctionData(functionFragment, calldata);

        return `${functionName}(token: ${this.tokenSymbol(
          tokenAddress,
        )}, amount: ${this.formatBN(
          amount,
          this.tokenSymbol(tokenAddress),
        )}, ${[deadline, v, r, s].join(", ")})`;
      }

      case "compareBalances": {
        return `${functionName}()`;
      }

      case "setFullCheckParams": {
        const [collateralHints, minHealthFactor] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );

        return `${functionName}(token: ${collateralHints
          .map((a: BigNumberish) => this.formatAmount(a))
          .join(", ")}, minHealthFactor: ${minHealthFactor})`;
      }

      case "storeExpectedBalances": {
        const [balanceDeltas] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );

        return `${functionName}(balanceDeltas: ${balanceDeltas
          .map(
            (b: BalanceDeltaStructOutput) =>
              `${this.tokenSymbol(b.token)}: ${this.formatBN(
                b.amount,
                this.tokenSymbol(b.token),
              )}`,
          )
          .join(", ")})`;
      }

      case "onDemandPriceUpdate": {
        const [token, reserve, data] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );

        return `${functionName}(token: ${this.tokenOrTickerSymbol(
          token,
        )}, reserve: ${reserve}, data: ${data})`;
      }

      default:
        return `${functionName}: Unknown operation ${functionFragment.name} with calldata ${calldata}`;
    }
  }

  formatAmount(amount: BigNumberish): string {
    return this.formatBN(amount, this.contract as SupportedToken);
  }
}
