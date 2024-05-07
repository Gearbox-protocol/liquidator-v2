import type { SupportedToken } from "@gearbox-protocol/sdk-gov";
import { toBigInt } from "@gearbox-protocol/sdk-gov";
import { IstETH__factory } from "@gearbox-protocol/types/v3";

import { AbstractParser } from "./abstractParser";
import type { IParser } from "./iParser";

export class LidoSTETHParser extends AbstractParser implements IParser {
  constructor(symbol: SupportedToken) {
    super(`LIDO_${symbol}`);
    this.ifc = IstETH__factory.createInterface();
  }

  parse(calldata: string): string {
    const { functionFragment, functionName } = this.parseSelector(calldata);

    switch (functionFragment.name) {
      case "getFee":
      case "totalSupply": {
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
