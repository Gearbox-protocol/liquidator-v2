import type { ICreditAccountsService } from "@gearbox-protocol/sdk";
import type { RevolverTransportValue } from "@gearbox-protocol/sdk/dev";
import { BaseError, type PublicClient, type Transport } from "viem";
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

  @DI.Inject(DI.CreditAccountService)
  caService!: ICreditAccountsService;

  @DI.Inject(DI.HealthChecker)
  healthChecker!: HealthCheckerService;

  @DI.Inject(DI.Client)
  client!: Client;

  @DI.Inject(DI.Output)
  outputWriter!: IOptimisticOutputWriter;

  @DI.Inject(DI.Swapper)
  swapper!: ISwapper;

  #staleBlockInterval?: NodeJS.Timeout;

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

    if (this.config.staleBlockThreshold > 0 && !this.config.optimistic) {
      this.log.info(
        `will check for stale blocks every ${this.config.staleBlockThreshold} seconds`,
      );
      this.#staleBlockInterval = setInterval(
        () => {
          this.#checkStaleBlock();
        },
        Math.min(this.config.staleBlockThreshold * 1000, 60_000),
      );
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
    if (this.#staleBlockInterval) {
      clearInterval(this.#staleBlockInterval);
    }
    process.exit(0);
  }

  async #checkStaleBlock(): Promise<void> {
    const timestamp = Number(this.caService.sdk.timestamp);
    const now = Math.ceil(Date.now() / 1000);
    const threshold = this.config.staleBlockThreshold;
    if (now - timestamp > threshold) {
      this.log.warn({ now, timestamp, threshold }, "stale block detected");
      await (
        this.caService.sdk.provider.publicClient as PublicClient<
          Transport<"revolver", RevolverTransportValue>
        >
      ).transport.rotate(
        new BaseError(`stale block detected: timestamp ${timestamp} at ${now}`),
      );
    }
  }
}
