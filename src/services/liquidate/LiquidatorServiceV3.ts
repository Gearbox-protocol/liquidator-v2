import Container, { Inject, Service } from "typedi";

import type { ConfigSchema } from "../../config";
import { CONFIG } from "../../config";
import { Logger, LoggerInterface } from "../../log";
import { RedstoneServiceV3 } from "../RedstoneServiceV3";
import AbstractLiquidatorService from "./AbstractLiquidatorService";
import LiquidationStrategyV3Full from "./LiquidationStrategyV3Full";
import LiquidationStrategyV3Partial from "./LiquidationStrategyV3Partial";
import type { ILiquidatorService } from "./types";

@Service()
export class LiquidatorServiceV3
  extends AbstractLiquidatorService
  implements ILiquidatorService
{
  @Logger("LiquidatorServiceV3")
  log: LoggerInterface;

  @Inject()
  redstone: RedstoneServiceV3;

  constructor() {
    super();
    const config = Container.get(CONFIG) as ConfigSchema;
    this.strategy =
      config.partialLiquidatorAddress || config.deployPartialLiquidatorContracts
        ? Container.get(LiquidationStrategyV3Partial)
        : Container.get(LiquidationStrategyV3Full);
  }

  /**
   * Launch LiquidatorService
   */
  public async launch(): Promise<void> {
    await super.launch();
    await this.strategy.launch();
  }
}
