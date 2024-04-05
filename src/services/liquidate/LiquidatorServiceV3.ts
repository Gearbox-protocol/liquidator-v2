import type { providers } from "ethers";
import { Inject, Service } from "typedi";

import Config from "../../config";
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
    this.strategy = Config.partialLiquidatorAddress
      ? (new LiquidationStrategyV3Partial() as any)
      : (new LiquidationStrategyV3Full() as any);
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
      redstone: this.redstone,
    });
  }
}
