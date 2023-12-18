import { detectNetwork } from "@gearbox-protocol/sdk";
import { Container, Inject, Service } from "typedi";

import config from "./config";
import { Logger, LoggerInterface } from "./log";
import { AMPQService } from "./services/ampqService";
import { HealthChecker } from "./services/healthChecker";
import { KeyService } from "./services/keyService";
import { OptimisticResults } from "./services/liquidate";
import { IOptimisticOutputWriter, OUTPUT_WRITER } from "./services/output";
import { ScanServiceV2, ScanServiceV3 } from "./services/scan";
import { ISwapper, SWAPPER } from "./services/swap";
import { getProvider } from "./services/utils";

@Service()
class App {
  @Logger("App")
  log: LoggerInterface;

  @Inject()
  scanServiceV2: ScanServiceV2;

  @Inject()
  scanServiceV3: ScanServiceV3;

  @Inject()
  keyService: KeyService;

  @Inject()
  ampqService: AMPQService;

  @Inject()
  healthChecker: HealthChecker;

  @Inject()
  optimistic: OptimisticResults;

  @Inject(OUTPUT_WRITER)
  outputWriter: IOptimisticOutputWriter;

  @Inject(SWAPPER)
  swapper: ISwapper;

  /**
   * Launch LiquidatorService
   */
  public async launch(): Promise<void> {
    const provider = getProvider(false, this.log);

    const startBlock = await provider.getBlockNumber();
    const { chainId } = await provider.getNetwork();

    const network = await detectNetwork(provider);
    this.log.info(
      `Launching on ${network} (${chainId}) using address provider ${config.addressProvider}`,
    );
    if (config.optimisticLiquidations) {
      this.log.warn(`Launching ${config.underlying} in OPTIMISTIC mode`);
    }

    this.healthChecker.launch();
    await this.ampqService.launch(chainId);

    await this.keyService.launch();
    await this.swapper.launch(network);
    await this.scanServiceV2.launch(provider);
    if (config.supportsV3) {
      await this.scanServiceV3.launch(provider);
    }

    if (config.optimisticLiquidations) {
      this.log.debug("optimistic liquidation finished, writing output");
      await this.outputWriter.write(startBlock, {
        result: this.optimistic.get(),
        startBlock,
      });
      this.log.debug("saved optimistic liquidation output, exiting");
    }
  }
}

export async function launchApp(): Promise<void> {
  await Container.get(App).launch();
}
