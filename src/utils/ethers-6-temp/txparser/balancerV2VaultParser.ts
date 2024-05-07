import type { SupportedContract } from "@gearbox-protocol/sdk-gov";
import type {
  SingleSwapDiffStructOutput,
  SingleSwapStructOutput,
} from "@gearbox-protocol/types/v3";
import { IBalancerV2VaultAdapter__factory } from "@gearbox-protocol/types/v3";

import { AbstractParser } from "./abstractParser";
import type { IParser } from "./iParser";

export class BalancerV2VaultParser extends AbstractParser implements IParser {
  constructor(contract: SupportedContract, isContract: boolean) {
    super(contract);
    this.ifc = IBalancerV2VaultAdapter__factory.createInterface();
    if (!isContract) this.adapterName = "BalancerV2Vault";
  }

  parse(calldata: string): string {
    const { functionFragment, functionName } = this.parseSelector(calldata);

    switch (functionFragment.name) {
      case "batchSwap": {
        return `${functionName}(undefined)`;
      }

      case "swapDiff": {
        const d = this.decodeFunctionData(functionFragment, calldata);
        const {
          assetIn = "",
          assetOut = "",
          leftoverAmount = 0,
        } = (d?.[0] || {}) as SingleSwapDiffStructOutput;

        return `${functionName}(${this.tokenSymbol(
          assetIn,
        )} => ${this.tokenSymbol(assetOut)} ${this.formatBN(
          leftoverAmount,
          this.tokenSymbol(assetIn),
        )}}`;
      }

      case "swap": {
        const d = this.decodeFunctionData(functionFragment, calldata);
        const {
          assetIn = "",
          assetOut = "",
          amount = 0,
        } = (d?.[0] || {}) as SingleSwapStructOutput;

        return `${functionName}(${this.tokenSymbol(
          assetIn,
        )} => ${this.tokenSymbol(assetOut)} ${this.formatBN(
          amount,
          this.tokenSymbol(assetIn),
        )}}`;
      }

      default:
        return `${functionName}: Unknown operation ${functionFragment.name} with calldata ${calldata}`;
    }
  }
}
