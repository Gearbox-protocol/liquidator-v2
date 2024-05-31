import { Wallet } from "ethers";
import { Container, Inject, Service } from "typedi";

import { CONFIG, Config, loadConfig } from "./config/index.js";
import { Logger, type LoggerInterface } from "./log/index.js";
import { AddressProviderService } from "./services/AddressProviderService.js";
import ExecutorService from "./services/ExecutorService.js";
import HealthCheckerService from "./services/HealthCheckerService.js";
import { OptimisticResults } from "./services/liquidate/index.js";
import {
  type IOptimisticOutputWriter,
  OUTPUT_WRITER,
} from "./services/output/index.js";
import { RedstoneServiceV3 } from "./services/RedstoneServiceV3.js";
import { ScanServiceV3 } from "./services/scan/index.js";
import { type ISwapper, SWAPPER } from "./services/swap/index.js";
import {
  getProvider,
  getViemPublicClient,
  PROVIDER,
  VIEM_PUBLIC_CLIENT,
} from "./utils/index.js";
import version from "./version.js";

@Service()
class App {
  @Logger("App")
  log: LoggerInterface;

  @Inject(CONFIG)
  config: Config;

  @Inject()
  addressProvider: AddressProviderService;

  @Inject()
  scanServiceV3: ScanServiceV3;

  @Inject()
  healthChecker: HealthCheckerService;

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

    await this.redstone.launch();

    this.healthChecker.launch();
    await this.swapper.launch(this.config.network);
    await this.scanServiceV3.launch();

    if (this.config.optimistic) {
      this.log.debug("optimistic liquidation finished, writing output");
      await this.outputWriter.write(this.config.startBlock, {
        result: this.optimistic.get(),
        startBlock: this.config.startBlock,
      });
      this.log.debug("saved optimistic liquidation output, exiting");
      process.exit(0);
    }
  }
}

export async function launchApp(): Promise<void> {
  const config = await loadConfig();
  Container.set(CONFIG, config);

  const provider = getProvider(config);
  Container.set(PROVIDER, provider);

  const viemPublicClient = getViemPublicClient();
  Container.set(VIEM_PUBLIC_CLIENT, viemPublicClient);

  const wallet = new Wallet(config.privateKey, provider);
  Container.set(Wallet, wallet);

  await Container.get(App).launch();
}
