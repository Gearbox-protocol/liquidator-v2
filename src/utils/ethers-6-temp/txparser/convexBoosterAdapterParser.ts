import type { SupportedContract } from "@gearbox-protocol/sdk-gov";
import { convexLpTokenByPid, convexPoolByPid } from "@gearbox-protocol/sdk-gov";
import { IConvexV1BoosterAdapter__factory } from "@gearbox-protocol/types/v3";
import type { BigNumberish } from "ethers";

import { AbstractParser } from "./abstractParser";
import type { IParser } from "./iParser";

export class ConvexBoosterAdapterParser
  extends AbstractParser
  implements IParser
{
  constructor(contract: SupportedContract, isContract: boolean) {
    super(contract);
    this.ifc = IConvexV1BoosterAdapter__factory.createInterface();
    if (!isContract) this.adapterName = "ConvexV1BoosterAdapter";
  }
  parse(calldata: string): string {
    const { functionFragment, functionName } = this.parseSelector(calldata);

    switch (functionFragment.name) {
      case "deposit": {
        const [pid, amount, stake] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );
        return `${functionName}(pid: ${this.formatPid(
          pid,
        )}, amount: ${this.formatAmount(amount, pid)}, stake: ${stake})`;
      }

      case "depositDiff": {
        const [pid, leftoverAmount, stake] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );
        return `${functionName}(pid: ${this.formatPid(
          pid,
        )}, leftoverAmount: ${this.formatAmount(
          leftoverAmount,
          pid,
        )}, stake: ${stake})`;
      }

      case "withdraw": {
        const [pid, amount] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );
        return `${functionName}(pid: ${this.formatPid(
          pid,
        )}, amount: ${this.formatAmount(amount, pid)})`;
      }

      case "withdrawDiff": {
        const [pid, leftoverAmount] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );
        return `${functionName}(pid: ${this.formatPid(
          pid,
        )}, leftoverAmount: ${this.formatAmount(leftoverAmount, pid)})`;
      }

      default:
        return `${functionName}: Unknown operation ${functionFragment.name} with calldata ${calldata}`;
    }
  }

  formatAmount(amount: BigNumberish, pid: number): string {
    return this.formatBN(amount, convexLpTokenByPid[pid]);
  }

  formatPid(pid: number): string {
    return `${pid} [${convexPoolByPid[pid]}]`;
  }
}
