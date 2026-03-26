import type { CreditAccountData } from "@gearbox-protocol/sdk";
import type { BatchLiquidatorSchema } from "../../config/index.js";
import AbstractLiquidator from "./AbstractLiquidator.js";
import type { ILiquidatorService } from "./types.js";

export default class BatchLiquidator
  extends AbstractLiquidator<BatchLiquidatorSchema>
  implements ILiquidatorService
{
  public override async launch(_asFallback?: boolean): Promise<void> {
    throw new Error("Batch liquidation mode is not supported for v310");
  }

  public async syncState(_blockNumber: bigint): Promise<void> {}

  public async liquidate(_accounts: CreditAccountData[]): Promise<void> {
    throw new Error("Batch liquidation mode is not supported for v310");
  }

  public async liquidateOptimistic(
    _accounts: CreditAccountData[],
  ): Promise<void> {
    throw new Error("Batch liquidation mode is not supported for v310");
  }
}
