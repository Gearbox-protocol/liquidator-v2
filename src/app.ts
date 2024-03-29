import { Container, Inject, Service } from "typedi";

import config from "./config";
import { Logger, LoggerInterface } from "./log";
import { AddressProviderService } from "./services/AddressProviderService";
import { AMPQService } from "./services/ampqService";
import { HealthChecker } from "./services/healthChecker";
import { KeyService } from "./services/keyService";
import { OptimisticResults } from "./services/liquidate";
import { IOptimisticOutputWriter, OUTPUT_WRITER } from "./services/output";
import { RedstoneServiceV3 } from "./services/RedstoneServiceV3";
import { ScanServiceV2, ScanServiceV3 } from "./services/scan";
import { ISwapper, SWAPPER } from "./services/swap";
import { getProvider } from "./services/utils";

@Service()
class App {
  @Logger("App")
  log: LoggerInterface;

  @Inject()
  addressProvider: AddressProviderService;

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

  @Inject()
  redstone: RedstoneServiceV3;

  @Inject(OUTPUT_WRITER)
  outputWriter: IOptimisticOutputWriter;

  @Inject(SWAPPER)
  swapper: ISwapper;

  /**
   * Launch LiquidatorService
   */
  public async launch(): Promise<void> {
    const msg = [
      "Launching",
      config.underlying ?? "",
      Array.from(config.enabledVersions)
        .map(v => `v${v}`)
        .join(", "),
      config.swapToEth ? `with swapping via ${config.swapToEth}` : "",
      config.optimisticLiquidations ? "in OPTIMISTIC mode" : "",
    ]
      .filter(Boolean)
      .join(" ");
    this.log.info(msg);
    await this.addressProvider.launch();
    const provider = getProvider(false, this.log);

    this.redstone.launch(provider);

    this.healthChecker.launch();
    await this.ampqService.launch(this.addressProvider.chainId);

    await this.keyService.launch();
    await this.swapper.launch(this.addressProvider.network);
    if (config.enabledVersions.has(3)) {
      await this.scanServiceV3.launch(provider);
    }
    if (config.enabledVersions.has(2)) {
      await this.scanServiceV2.launch(provider);
    }

    if (config.optimisticLiquidations) {
      this.log.debug("optimistic liquidation finished, writing output");
      await this.outputWriter.write(this.addressProvider.startBlock, {
        result: this.optimistic.get(),
        startBlock: this.addressProvider.startBlock,
      });
      this.log.debug("saved optimistic liquidation output, exiting");
      process.exit(0);
    }
  }
}

export async function launchApp(): Promise<void> {
  await Container.get(App).launch();
}
