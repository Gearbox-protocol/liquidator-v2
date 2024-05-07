import { ICreditManagerV3__factory } from "@gearbox-protocol/types/v3";

import { AbstractParser } from "./abstractParser";
import type { IParser } from "./iParser";

export class CreditManagerParser extends AbstractParser implements IParser {
  constructor(version: number) {
    super(`CreditManager_V${version}`);
    this.ifc = ICreditManagerV3__factory.createInterface();
  }
  parse(calldata: string): string {
    const { functionFragment, functionName } = this.parseSelector(calldata);

    switch (functionFragment.name) {
      case "creditConfigurator": {
        return `${functionName}()`;
      }

      default:
        return `${functionName}: Unknown operation ${functionFragment.name} with calldata ${calldata}`;
    }
  }
}
