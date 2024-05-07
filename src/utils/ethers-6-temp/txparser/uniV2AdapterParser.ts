import type { SupportedContract } from "@gearbox-protocol/sdk-gov";
import { formatBN } from "@gearbox-protocol/sdk-gov";
import { IUniswapV2Adapter__factory } from "@gearbox-protocol/types/v3";

import { AbstractParser } from "./abstractParser";
import type { IParser } from "./iParser";

export class UniswapV2AdapterParser extends AbstractParser implements IParser {
  constructor(contract: SupportedContract, isContract: boolean) {
    super(contract);
    this.ifc = IUniswapV2Adapter__factory.createInterface();
    if (!isContract) this.adapterName = "UniswapV2Adapter";
  }
  parse(calldata: string): string {
    return this._parse(calldata);
  }

  protected _parse(calldata: string): string {
    const { functionFragment, functionName } = this.parseSelector(calldata);

    switch (functionFragment.name) {
      case "swapExactTokensForTokens": {
        const [amountIn, amountOutMin, path] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );
        const pathStr = (path as Array<string>)
          .map(r => this.tokenSymbol(r))
          .join(" => ");

        const tokenIn = this.tokenSymbol(path[0]);
        const tokenOut = this.tokenSymbol(path[path.length - 1]);
        const amountInStr = this.formatBN(amountIn, tokenIn);
        const amountOutStr = this.formatBN(amountOutMin, tokenOut);
        return `${functionName}(amountIn: ${amountInStr}, amountOutMin: ${amountOutStr}, path: [${pathStr}])`;
      }

      case "swapTokensForExactTokens": {
        const [amountOut, amountInMax, path] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );

        const pathStr = (path as Array<string>)
          .map(r => this.tokenSymbol(r))
          .join(" => ");

        const tokenIn = this.tokenSymbol(path[0]);
        const tokenOut = this.tokenSymbol(path[path.length - 1]);
        const amountOutStr = this.formatBN(amountOut, tokenIn);
        const amountInMaxStr = this.formatBN(amountInMax, tokenOut);

        return `${functionName}(amountOut: ${amountOutStr}, amountInMax: ${amountInMaxStr}, path: [${pathStr}])`;
      }

      case "swapDiffTokensForTokens": {
        const [leftoverAmount, rateMinRAY, path] = this.decodeFunctionData(
          functionFragment,
          calldata,
        );

        const tokenIn = this.tokenSymbol(path[0]);

        return `${functionName}(leftoverAmount: ${this.formatBN(
          leftoverAmount,
          tokenIn,
        )}, rate: ${formatBN(rateMinRAY, 27)}, path: [${(path as Array<string>)
          .map(r => this.tokenSymbol(r))
          .join(" => ")}])`;
      }

      default:
        return `${functionName}: Unknown operation ${functionFragment.name} with calldata ${calldata}`;
    }
  }
}
