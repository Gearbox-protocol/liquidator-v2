import { IPriceOracleBase__factory } from "@gearbox-protocol/types/v3";

import { AbstractParser } from "./abstractParser";
import type { IParser } from "./iParser";

export class PriceOracleParser extends AbstractParser implements IParser {
  constructor() {
    super("PriceOracle");
    this.ifc = IPriceOracleBase__factory.createInterface();
  }
  parse(calldata: string): string {
    const { functionFragment, functionName } = this.parseSelector(calldata);

    switch (functionFragment.name) {
      case "getPrice": {
        const [token] = this.decodeFunctionData(functionFragment, calldata);

        return `${functionName}(${this.tokenSymbol(token)})`;
      }

      default:
        return `${functionName}: Unknown operation ${functionFragment.name} with calldata ${calldata}`;
    }
  }
}
