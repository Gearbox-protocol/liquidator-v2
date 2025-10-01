import { createServer, type Server } from "node:http";
import {
  type GearboxSDK,
  type ICreditAccountsService,
  json_stringify,
} from "@gearbox-protocol/sdk";
import type { RevolverTransportValue } from "@gearbox-protocol/sdk/dev";
import { customAlphabet } from "nanoid";
import type { PublicClient, Transport } from "viem";
import type { Config } from "../config/index.js";
import { DI } from "../di.js";
import type { ILogger } from "../log/index.js";
import { Logger } from "../log/index.js";
import version from "../version.js";
import type Client from "./Client.js";
import type { Scanner } from "./Scanner.js";

const nanoid = customAlphabet("1234567890abcdef", 8);

@DI.Injectable(DI.HealthChecker)
export default class HealthCheckerService {
  @Logger("HealthChecker")
  log!: ILogger;

  @DI.Inject(DI.Scanner)
  scanner!: Scanner;

  @DI.Inject(DI.Config)
  config!: Config;

  @DI.Inject(DI.CreditAccountService)
  caService!: ICreditAccountsService;

  @DI.Inject(DI.Client)
  client!: Client;

  #start = Math.round(Date.now() / 1000);
  #id = nanoid();
  #server?: Server;

  /**
   * Launches health checker - simple web server
   */
  public launch(): void {
    if (this.config.optimistic) {
      return;
    }

    const server = createServer(async (req, res) => {
      const timestamp = Number(this.sdk.timestamp);
      const now = Math.ceil(Date.now() / 1000);
      const threshold = this.config.staleBlockThreshold;
      // Routing
      if (req.url === "/") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          json_stringify({
            startTime: this.#start,
            version,
            network: this.config.network,
            family: "liquidators",
            liquidationMode: this.config.liquidationMode,
            address: this.client.address,
            balance: this.client.balance,
            currentBlock: this.sdk.currentBlock,
            timestamp: {
              value: timestamp,
              healthy: !!threshold && now - timestamp <= threshold,
            },
            marketsConfigurators:
              this.sdk.marketRegister.marketConfigurators.map(mc => mc.address),
            pools: this.sdk.marketRegister.pools.map(p => p.pool.address),
            creditManagers: this.sdk.marketRegister.creditManagers.map(
              cm => cm.creditManager.address,
            ),
            providers: (
              this.sdk.provider.publicClient as PublicClient<
                Transport<"revolver", RevolverTransportValue>
              >
            ).transport.statuses(),
          }),
        );
      } else if (req.url === "/metrics") {
        try {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end(this.#metrics());
        } catch (_ex) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("error");
        }
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
      }
    });

    const host = "0.0.0.0";
    server.listen({ host, port: this.config.port }, () => {
      this.log.debug(`listening on ${host}:${this.config.port}`);
    });
    server.on("error", e => {
      this.log.error(e);
    });
    server.unref();
    this.#server = server;
    this.log.info("launched");
  }

  public async stop(): Promise<void> {
    this.log.info("stopping");
    return new Promise(resolve => {
      if (!this.#server) {
        resolve();
        return;
      }
      this.#server.close(() => resolve());
    });
  }

  /**
   * Returns metrics in prometheus format
   * https://prometheus.io/docs/concepts/data_model/
   */
  #metrics(): string {
    const labels = Object.entries({
      instance_id: this.#id,
      network: this.config.network.toLowerCase(),
      version,
    })
      .map(([k, v]) => `${k}="${v}"`)
      .join(", ");
    return `# HELP service_up Simple binary flag to indicate being alive
# TYPE service_up gauge
service_up{${labels}} 1

# HELP start_time Start time, in unixtime
# TYPE start_time gauge
start_time{${labels}} ${this.#start}

# HELP block_number Latest processed block
# TYPE block_number gauge
block_number{${labels}} ${this.scanner.lastUpdated}

`;
  }

  private get sdk(): GearboxSDK {
    return this.caService.sdk;
  }
}
