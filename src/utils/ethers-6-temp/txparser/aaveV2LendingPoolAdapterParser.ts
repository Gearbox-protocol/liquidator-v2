import type { SupportedContract } from "@gearbox-protocol/sdk-gov";
import { IAaveV2_LendingPoolAdapter__factory } from "@gearbox-protocol/types/v3";

import { AbstractParser } from "./abstractParser.js";
import type { IParser } from "./iParser.js";

export class AaveV2LendingPoolAdapterParser
  extends AbstractParser
  implements IParser
{
  constructor(contract: SupportedContract, isContract: boolean) {
    super(contract);
    this.ifc = IAaveV2_LendingPoolAdapter__factory.createInterface();
    if (!isContract) this.adapterName = "AaveV2_LendingPoolAdapter";
  }

  parse(calldata: string): string {
    const { functionFragment, functionName } = this.parseSelector(calldata);

    switch (functionFragment.name) {
      default:
        return `${functionName}: Unknown operation ${functionFragment.name} with calldata ${calldata}`;
    }
  }
}
