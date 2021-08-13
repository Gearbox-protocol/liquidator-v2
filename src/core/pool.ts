import { PoolData, PoolDataPayload } from "@diesellabs/gearbox-sdk";
import { BigNumber } from "ethers";
import { RAY, SECONDS_PER_YEAR } from "./constants";

export class Pool extends PoolData {
  constructor(payload: PoolDataPayload) {
    super(payload);
  }

  //                                    /     currentBorrowRate * timeDifference \
  //  newCumIndex  = currentCumIndex * | 1 + ------------------------------------ |
  //                                    \              SECONDS_PER_YEAR          /
  //
  calcCurrentCumulativeIndex(timestamp: number): BigNumber {
    const timeDifference = this.timestampLU.sub(timestamp);
    return this.borrowAPYRay
      .mul(timeDifference)
      .div(SECONDS_PER_YEAR)
      .add(RAY)
      .mul(this.cumulativeIndex_RAY)
      .div(RAY);
  }
}
