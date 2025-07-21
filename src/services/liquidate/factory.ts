import type { IFactory } from "di-at-home";

import type { Config } from "../../config/index.js";
import { DI } from "../../di.js";
import BatchLiquidator from "./BatchLiquidator.js";
import SingularFullLiquidator from "./SingularFullLiquidator.js";
import SingularPartialLiquidator from "./SingularPartialLiquidator.js";
import type { ILiquidatorService } from "./types.js";

@DI.Factory(DI.Liquidator)
export class LiquidatorFactory implements IFactory<ILiquidatorService, []> {
  @DI.Inject(DI.Config)
  config!: Config;

  produce(): ILiquidatorService {
    switch (this.config.liquidationMode) {
      case "full":
        return new SingularFullLiquidator();
      case "partial":
        return new SingularPartialLiquidator();
      case "batch":
        return new BatchLiquidator();
      default:
        throw new Error(
          `Invalid liquidation mode: ${this.config.liquidationMode}`,
        );
    }
  }
}
