import type { providers } from "ethers";
import { Service } from "typedi";

import { Logger, LoggerInterface } from "../../log";
import AbstractLiquidatorService from "./AbstractLiquidatorService";
import LiquidationStrategyV2Full from "./LiquidationStrategyV2Full";
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
    this.strategy = new LiquidationStrategyV2Full() as any;
  }

  /**
   * Launch LiquidatorService
   */
  public async launch(provider: providers.Provider): Promise<void> {
    await super.launch(provider);
    await this.strategy.launch({
      logger: this.log,
      addressProvider: this.addressProvider,
      provider,
    });
  }
}
