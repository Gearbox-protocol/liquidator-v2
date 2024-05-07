import type { SupportedContract } from "@gearbox-protocol/sdk-gov";
import { ICompoundV2_CTokenAdapter__factory } from "@gearbox-protocol/types/v3";

import { AbstractParser } from "./abstractParser";
import type { IParser } from "./iParser";

export class CompoundV2CTokenAdapterParser
  extends AbstractParser
  implements IParser
{
  constructor(contract: SupportedContract, isContract: boolean) {
    super(contract);
    this.ifc = ICompoundV2_CTokenAdapter__factory.createInterface();
    if (!isContract) this.adapterName = "CompoundV2_CTokenAdapter";
  }

  parse(calldata: string): string {
    const { functionFragment, functionName } = this.parseSelector(calldata);

    switch (functionFragment.name) {
      default:
        return `${functionName}: Unknown operation ${functionFragment.name} with calldata ${calldata}`;
    }
  }
}
