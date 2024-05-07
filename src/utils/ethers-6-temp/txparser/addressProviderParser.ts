import { IAddressProviderV3__factory } from "@gearbox-protocol/types/v3";

import { AbstractParser } from "./abstractParser";
import type { IParser } from "./iParser";

export class AddressProviderParser extends AbstractParser implements IParser {
  constructor() {
    super("AddressProvider");
    this.ifc = IAddressProviderV3__factory.createInterface();
  }
  parse(calldata: string): string {
    const { functionFragment, functionName } = this.parseSelector(calldata);

    switch (functionFragment.name) {
      case "getWethToken":
      case "getGearToken":
      case "getLeveragedActions":
      case "getDataCompressor":
      case "getWETHGateway":
      case "getPriceOracle": {
        return `${functionName}()`;
      }

      default:
        return `${functionName}: Unknown operation ${functionFragment.name} with calldata ${calldata}`;
    }
  }
}
