import type { SupportedContract } from "@gearbox-protocol/sdk-gov";
import { IERC4626Adapter__factory } from "@gearbox-protocol/types/v3";

import { AbstractParser } from "./abstractParser.js";
import type { IParser } from "./iParser.js";

export class ERC4626AdapterParser extends AbstractParser implements IParser {
  constructor(contract: SupportedContract, isContract: boolean) {
    super(contract);
    this.ifc = IERC4626Adapter__factory.createInterface();
    if (!isContract) this.adapterName = "ERC4626Adapter";
  }

  parse(calldata: string): string {
    const { functionFragment, functionName } = this.parseSelector(calldata);

    switch (functionFragment.name) {
      default:
        return `${functionName}: Unknown operation ${functionFragment.name} with calldata ${calldata}`;
    }
  }
}
