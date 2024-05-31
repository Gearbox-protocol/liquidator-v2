import type {
  CurveParams,
  SupportedContract,
  SupportedToken,
} from "@gearbox-protocol/sdk-gov";
import { contractParams, formatBN } from "@gearbox-protocol/sdk-gov";
import {
  ICurveV1_2AssetsAdapter__factory,
  ICurveV1_3AssetsAdapter__factory,
  ICurveV1_4AssetsAdapter__factory,
} from "@gearbox-protocol/types/v3";
import type { BigNumberish } from "ethers";

import { AbstractParser } from "./abstractParser.js";
import type { IParser } from "./iParser.js";

export class CurveAdapterParser extends AbstractParser implements IParser {
  protected lpToken: SupportedToken;

  constructor(contract: SupportedContract, isContract: boolean) {
    super(contract);

    let contractName = "";

    const nCoins = (contractParams[contract] as CurveParams).tokens.length;
    switch (nCoins) {
      case 2:
        this.ifc = ICurveV1_2AssetsAdapter__factory.createInterface();
        contractName = `Curve2AssetsAdapter`;
        break;
      case 3:
        this.ifc = ICurveV1_3AssetsAdapter__factory.createInterface();
        contractName = `Curve3AssetsAdapter`;
        break;
      case 4:
        this.ifc = ICurveV1_4AssetsAdapter__factory.createInterface();
        contractName = `Curve4AssetsAdapter`;
        break;
      default:
        throw new Error(`Unsupported curve contract ${contract}`);
    }
    this.lpToken = (contractParams[contract] as CurveParams).lpToken;
    if (!isContract) this.adapterName = contractName;
  }
  parse(calldata: string): string {
    const { functionFragment, functionName } = this.parseSelector(calldata);

    switch (functionFragment.name) {
      case "exchange":
      case "exchange_underlying": {
        const [i, j, dx, min_dy] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );

        const iSym =
          functionFragment.name === "exchange_underlying"
            ? this.getUnderlyingTokenByIndex(i)
            : this.getTokenByIndex(i);

        const jSym =
          functionFragment.name === "exchange_underlying"
            ? this.getUnderlyingTokenByIndex(j)
            : this.getTokenByIndex(j);

        return `${functionName}(i ,j: ${iSym} => ${jSym}, dx: ${this.formatBN(
          dx,
          iSym,
        )}, min_dy: ${this.formatBN(min_dy, jSym)})`;
      }

      case "exchange_diff":
      case "exchange_diff_underlying": {
        const [i, j, leftoverAmount, rateMinRAY] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );

        const iSym =
          functionFragment.name === "exchange_diff_underlying"
            ? this.getUnderlyingTokenByIndex(i)
            : this.getTokenByIndex(i);

        const jSym =
          functionFragment.name === "exchange_diff_underlying"
            ? this.getUnderlyingTokenByIndex(j)
            : this.getTokenByIndex(j);

        return `${functionName}(i: ${iSym}, j: ${jSym}, leftoverAmount: ${this.formatBN(
          leftoverAmount,
          iSym,
        )}, rateMinRAY: ${formatBN(rateMinRAY, 27)}`;
      }

      case "add_liquidity_one_coin": {
        const [amount, i, minAmount] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );

        const iSym = this.getTokenByIndex(i);

        return `${functionName}(amount: ${this.formatBN(
          amount,
          iSym,
        )}, i: ${iSym}, minAmount: ${this.formatBN(minAmount, this.lpToken)})`;
      }

      case "add_diff_liquidity_one_coin":
      case "remove_diff_liquidity_one_coin": {
        const [leftoverAmount, i, rateMinRAY] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );

        return `${functionName}(leftoverAmount: ${this.formatBN(
          leftoverAmount,
          i,
        )}, i: ${this.getTokenByIndex(i)}, rateMinRAY: ${formatBN(
          rateMinRAY,
          27,
        )})`;
      }

      case "add_liquidity": {
        const [amounts, minAmount] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );

        return `${functionName}(amounts: [${this.convertAmounts(
          amounts,
        )}], minAmount: ${this.formatBN(minAmount, this.lpToken)})`;
      }

      case "remove_liquidity": {
        const [amount, min_amounts] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );

        return `${functionName}(amount: ${this.formatBN(
          amount,
          this.lpToken,
        )}, min_amounts: [${this.convertAmounts(min_amounts)}])`;
      }

      case "remove_liquidity_imbalance": {
        const [amounts, maxBurnAmount] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );

        return `${functionName}(amounts: [${this.convertAmounts(
          amounts,
        )}], max_burn_amount: ${this.formatBN(maxBurnAmount, this.lpToken)})`;
      }

      case "remove_liquidity_one_coin": {
        const [amount, i, min_amount] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );

        const iSym = this.getTokenByIndex(i);

        return `${functionName}(amount: ${this.formatBN(
          amount,
          this.lpToken,
        )},i: ${iSym}, min_amount: ${this.formatBN(min_amount, iSym)})`;
      }

      case "totalSupply": {
        return `${functionName}()`;
      }

      case "balances": {
        const [i] = this.decodeFunctionData(functionFragment, calldata);
        return `${functionName}(${this.getTokenByIndex(i)})`;
      }
      case "balanceOf": {
        const [address] = this.decodeFunctionData(functionFragment, calldata);
        return `${functionName}(${address})`;
      }
      case "get_virtual_price": {
        return `${functionName}()`;
      }

      case "allowance": {
        const [account, to] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );
        return `${functionName}(account: ${account}, to: ${to})`;
      }

      default:
        return `${functionName}: Unknown operation ${functionFragment.name} with calldata ${calldata}`;
    }
  }

  getTokenByIndex(index: number): SupportedToken {
    return (contractParams[this.contract as SupportedContract] as CurveParams)
      .tokens[index];
  }

  getUnderlyingTokenByIndex(index: number): SupportedToken {
    return (contractParams[this.contract as SupportedContract] as CurveParams)
      .underlyings![index];
  }

  convertAmounts(amounts: Array<BigNumberish>): string {
    return amounts
      .map((a, coin) => {
        const sym = this.getTokenByIndex(coin);
        return `${sym}: ${this.formatBN(a, sym)}`;
      })
      .join(", ");
  }
}
