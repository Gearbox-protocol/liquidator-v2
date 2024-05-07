import { IPoolV3__factory } from "@gearbox-protocol/types/v3";

import { AbstractParser } from "./abstractParser";
import type { IParser } from "./iParser";

export class PoolParser extends AbstractParser implements IParser {
  constructor(version: number) {
    super(`Pool_V${version}`);
    this.ifc = IPoolV3__factory.createInterface();
  }
  parse(calldata: string): string {
    const { functionFragment, functionName } = this.parseSelector(calldata);

    switch (functionFragment.name) {
      default:
        return `${functionName}: Unknown operation ${functionFragment.name} with calldata ${calldata}`;
    }
  }
}
