import { providers, Wallet } from "ethers";
import { Container, Inject, Service } from "typedi";

import { CONFIG, ConfigSchema, loadConfig } from "./config";
import { Logger, LoggerInterface } from "./log";
import { AddressProviderService } from "./services/AddressProviderService";
import { AMPQService } from "./services/ampqService";
import ExecutorService from "./services/ExecutorService";
import { HealthChecker } from "./services/healthChecker";
import { OptimisticResults } from "./services/liquidate";
import { IOptimisticOutputWriter, OUTPUT_WRITER } from "./services/output";
import { RedstoneServiceV3 } from "./services/RedstoneServiceV3";
import { ScanServiceV3 } from "./services/scan";
import { ISwapper, SWAPPER } from "./services/swap";
import { getProvider } from "./services/utils";
import version from "./version";

@Service()
class App {
  @Logger("App")
  log: LoggerInterface;

  @Inject(CONFIG)
  config: ConfigSchema;

  @Inject()
  addressProvider: AddressProviderService;

  @Inject()
  scanServiceV3: ScanServiceV3;

  @Inject()
  ampqService: AMPQService;

  @Inject()
  healthChecker: HealthChecker;

  @Inject()
  optimistic: OptimisticResults;

  @Inject()
  redstone: RedstoneServiceV3;

  @Inject()
  executor: ExecutorService;

  @Inject(OUTPUT_WRITER)
  outputWriter: IOptimisticOutputWriter;

  @Inject(SWAPPER)
  swapper: ISwapper;

  public async launch(): Promise<void> {
    const msg = [
      `Launching liquidator v${version}`,
      this.config.underlying ?? "",
      this.config.swapToEth ? `with swapping via ${this.config.swapToEth}` : "",
      this.config.optimistic ? "in OPTIMISTIC mode" : "",
    ]
      .filter(Boolean)
      .join(" ");
    this.log.info(msg);

    await this.executor.launch();
    await this.addressProvider.launch();

    this.redstone.launch();

    this.healthChecker.launch();
    await this.ampqService.launch(this.addressProvider.chainId);

    await this.swapper.launch(this.addressProvider.network);
    await this.scanServiceV3.launch();

    if (this.config.optimistic) {
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
  const config = loadConfig();
  Container.set(CONFIG, config);

  const provider = getProvider();
  Container.set(providers.Provider, provider);

  const wallet = new Wallet(config.privateKey, provider);
  Container.set(Wallet, wallet);

  await Container.get(App).launch();
}
