import type { Config } from "./config/index.js";
import { DI } from "./di.js";
import { type ILogger, Logger } from "./log/index.js";
import type Client from "./services/Client.js";
import type HealthCheckerService from "./services/HealthCheckerService.js";
import type { IOptimisticOutputWriter } from "./services/output/index.js";
import type { Scanner } from "./services/Scanner.js";
import type { ISwapper } from "./services/swap/index.js";

export default class Liquidator {
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

    process.on("SIGTERM", async s => {
      await this.#stop(s);
    });
    process.on("SIGINT", async s => {
      await this.#stop(s);
    });
  }

  async #stop(signal: string): Promise<void> {
    this.log.info(`stopping on ${signal}`);
    this.log.info("terminating");
    await Promise.allSettled([this.healthChecker.stop(), this.scanner.stop()]);
    this.log.info(`stopped by ${signal}`);
    process.exit(0);
  }
}
