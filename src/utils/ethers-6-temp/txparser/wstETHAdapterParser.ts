import type { SupportedContract } from "@gearbox-protocol/sdk-gov";
import { toBigInt } from "@gearbox-protocol/sdk-gov";
import {
  IwstETH__factory,
  IwstETHV1Adapter__factory,
} from "@gearbox-protocol/types/v3";

import { AbstractParser } from "./abstractParser";
import type { IParser } from "./iParser";

export class WstETHAdapterParser extends AbstractParser implements IParser {
  constructor(contract: SupportedContract, isContract: boolean) {
    super(contract);
    this.ifc = !isContract
      ? IwstETHV1Adapter__factory.createInterface()
      : IwstETH__factory.createInterface();
    if (!isContract) this.adapterName = "wstETHAdapter";
  }
  parse(calldata: string): string {
    const { functionFragment, functionName } = this.parseSelector(calldata);

    switch (functionFragment.name) {
      case "wrap": {
        const [amount] = this.decodeFunctionData(functionFragment, calldata);
        return `${functionName}(amount: ${this.formatBN(amount, "STETH")})`;
      }
      case "wrapDiff": {
        const [leftoverAmount] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );
        return `${functionName}(leftoverAmount: ${this.formatBN(
          leftoverAmount,
          "STETH",
        )})`;
      }

      case "unwrap": {
        const [amount] = this.decodeFunctionData(functionFragment, calldata);
        return `${functionName}(amount: ${this.formatBN(amount, "wstETH")})`;
      }
      case "unwrapDiff": {
        const [leftoverAmount] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );
        return `${functionName}(leftoverAmount: ${this.formatBN(
          leftoverAmount,
          "STETH",
        )})`;
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
      case "approve": {
        const [spender, amount] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );
        return `${functionName}(${spender}, [${toBigInt(amount).toString()}])`;
      }

      default:
        return `${functionName}: Unknown operation ${functionFragment.name} with calldata ${calldata}`;
    }
  }
}
