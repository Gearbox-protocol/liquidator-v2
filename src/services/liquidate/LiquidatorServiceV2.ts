import Container, { Service } from "typedi";

import { Logger, LoggerInterface } from "../../log";
import AbstractLiquidatorService from "./AbstractLiquidatorService";
import LiquidationStrategyV2 from "./LiquidationStrategyV2";
import type { ILiquidatorService } from "./types";

@Service()
export class LiquidatorServiceV2
  extends AbstractLiquidatorService
  implements ILiquidatorService
{
  @Logger("LiquidatorServiceV2")
  log: LoggerInterface;

  constructor() {
    super();
    this.strategy = Container.get(LiquidationStrategyV2);
  }

  /**
   * Launch LiquidatorService
   */
  public async launch(): Promise<void> {
    await super.launch();
    await this.strategy.launch();
  }
}
