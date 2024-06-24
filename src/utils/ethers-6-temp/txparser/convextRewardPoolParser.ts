import type { NormalToken } from "@gearbox-protocol/sdk-gov";
import { IBaseRewardPool__factory } from "@gearbox-protocol/types/v3";

import { AbstractParser } from "./abstractParser.js";
import type { IParser } from "./iParser.js";

export class ConvexRewardPoolParser extends AbstractParser implements IParser {
  constructor(token: NormalToken) {
    super(`ConvexRewardPool_${token}`);
    this.ifc = IBaseRewardPool__factory.createInterface();
  }
  parse(calldata: string): string {
    const { functionFragment, functionName } = this.parseSelector(calldata);

    switch (functionFragment.name) {
      case "rewardRate":
        return `${functionName}()`;

      default:
        return `${functionName}: Unknown operation ${functionFragment.name} with calldata ${calldata}`;
    }
  }
}
