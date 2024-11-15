import type { SupportedContract } from "@gearbox-protocol/sdk-gov";
import { IStakingRewardsAdapter__factory } from "@gearbox-protocol/types/v3";

import { AbstractParser } from "./abstractParser.js";
import type { IParser } from "./iParser.js";

export class StakingRewardsAdapterParser
  extends AbstractParser
  implements IParser
{
  constructor(contract: SupportedContract, isContract: boolean) {
    super(contract);
    this.ifc = IStakingRewardsAdapter__factory.createInterface();
    if (!isContract) this.adapterName = "StakingRewardsAdapter";
  }

  parse(calldata: string): string {
    const { functionFragment, functionName } = this.parseSelector(calldata);

    switch (functionFragment.name) {
      default:
        return `${functionName}: Unknown operation ${functionFragment.name} with calldata ${calldata}`;
    }
  }
}
