import attachSDK from "./attachSDK.js";
import { Config } from "./config/index.js";
import { DI } from "./di.js";
import { type ILogger, Logger } from "./log/index.js";
import type Client from "./services/Client.js";
import type HealthCheckerService from "./services/HealthCheckerService.js";
import type { IOptimisticOutputWriter } from "./services/output/index.js";
import type { Scanner } from "./services/scanner/index.js";
import type { ISwapper } from "./services/swap/index.js";
import version from "./version.js";

class App {
  @Logger("App")
  log!: ILogger;

  @DI.Inject(DI.Config)
  config!: Config;

  @DI.Inject(DI.Scanner)
  scanner!: Scanner;

  @DI.Inject(DI.HealthChecker)
  healthChecker!: HealthCheckerService;

  @DI.Inject(DI.Client)
  client!: Client;

  @DI.Inject(DI.Output)
  outputWriter!: IOptimisticOutputWriter;

  @DI.Inject(DI.Swapper)
  swapper!: ISwapper;

  public async launch(): Promise<void> {
    const msg = [
      `Launching liquidator v${version}`,
      this.config.swapToEth ? `with swapping via ${this.config.swapToEth}` : "",
      this.config.optimistic ? "in OPTIMISTIC mode" : "",
    ]
      .filter(Boolean)
      .join(" ");
    this.log.info(msg);

    await this.client.launch();

    this.healthChecker.launch();
    await this.swapper.launch(this.config.network);
    await this.scanner.launch();

    if (this.config.optimistic) {
      this.log.debug("optimistic liquidation finished, writing output");
      await this.outputWriter.write();
      this.log.debug("saved optimistic liquidation output, exiting");
      process.exit(0);
    }
  }
}

export async function launchApp(): Promise<void> {
  const config = await Config.load();
  DI.set(DI.Config, config);
  const service = await attachSDK();
  DI.set(DI.CreditAccountService, service);
  const app = new App();
  await app.launch();
}
