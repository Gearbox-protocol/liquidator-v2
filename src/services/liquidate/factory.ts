import type { Config } from "@gearbox-protocol/liquidator-v2-config";
import type { IFactory } from "di-at-home";
import { DI } from "../../di.js";
import BatchLiquidator from "./BatchLiquidator.js";
import SingularLiquidator from "./SingularLiquidator.js";
import type { ILiquidatorService } from "./types.js";

@DI.Factory(DI.Liquidator)
export class LiquidatorFactory implements IFactory<ILiquidatorService, []> {
  @DI.Inject(DI.Config)
  config!: Config;

  produce(): ILiquidatorService {
    const liquidationMode = this.config.liquidationMode ?? "full";
    switch (liquidationMode) {
      case "full":
      case "partial":
      case "deleverage":
        return new SingularLiquidator();
      case "batch":
        return new BatchLiquidator();
      default:
        throw new Error(`Invalid liquidation mode: ${liquidationMode}`);
    }
  }
}
