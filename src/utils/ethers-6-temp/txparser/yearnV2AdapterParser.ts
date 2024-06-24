import type { SupportedContract } from "@gearbox-protocol/sdk-gov";
import { contractsByNetwork } from "@gearbox-protocol/sdk-gov";
import { IYearnV2Adapter__factory } from "@gearbox-protocol/types/v3";

import { AbstractParser } from "./abstractParser.js";
import type { IParser } from "./iParser.js";

export class YearnV2AdapterParser extends AbstractParser implements IParser {
  constructor(contract: SupportedContract, isContract: boolean) {
    super(contract);
    this.ifc = IYearnV2Adapter__factory.createInterface();
    if (!isContract) this.adapterName = "YearnV2Adapter";
  }
  parse(calldata: string): string {
    const { functionFragment, functionName } = this.parseSelector(calldata);

    switch (functionFragment.name) {
      case "deposit":
      case "withdraw":
      case "withdraw(uint256,address,uint256)": {
        const [amount, address, maxLoss] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );

        const yvSym = this.tokenSymbol(
          contractsByNetwork.Mainnet[this.contract as SupportedContract],
        );

        const amountStr = amount
          ? `amount: ${this.formatBN(amount, yvSym)}`
          : "";
        const addressStr = address ? `, address: ${address}` : "";
        const maxLossStr = maxLoss ? `, maxLoss: ${maxLoss}` : "";

        return `${functionName}(${amountStr}${addressStr}${maxLossStr})`;
      }

      case "depositDiff": {
        const [leftoverAmount] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );

        const yvSym = this.tokenSymbol(
          contractsByNetwork.Mainnet[this.contract as SupportedContract],
        );

        const leftoverAmountStr = this.formatBN(leftoverAmount, yvSym);

        return `${functionName}(leftoverAmount: ${leftoverAmountStr})`;
      }

      case "withdrawDiff": {
        const [leftoverAmount] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );

        const yvSym = this.tokenSymbol(
          contractsByNetwork.Mainnet[this.contract as SupportedContract],
        );

        const leftoverAmountStr = this.formatBN(leftoverAmount, yvSym);

        return `${functionName}(leftoverAmount: ${leftoverAmountStr})`;
      }

      case "pricePerShare": {
        return `${functionName}()`;
      }
      case "balanceOf": {
        const [address] = this.decodeFunctionData(functionFragment, calldata);
        return `${functionName}(${address})`;
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
}
