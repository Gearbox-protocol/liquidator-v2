import type { SupportedContract } from "@gearbox-protocol/sdk-gov";
import { ICamelotV3Adapter__factory } from "@gearbox-protocol/types/v3";

import { AbstractParser } from "./abstractParser";
import type { IParser } from "./iParser";

export class CamelotV3AdapterParser extends AbstractParser implements IParser {
  constructor(contract: SupportedContract, isContract: boolean) {
    super(contract);
    this.ifc = ICamelotV3Adapter__factory.createInterface();
    if (!isContract) this.adapterName = "CamelotV3Adapter";
  }

  parse(calldata: string): string {
    const { functionFragment, functionName } = this.parseSelector(calldata);

    switch (functionFragment.name) {
      default:
        return `${functionName}: Unknown operation ${functionFragment.name} with calldata ${calldata}`;
    }
  }
}
