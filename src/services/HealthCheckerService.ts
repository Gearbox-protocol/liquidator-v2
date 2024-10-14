import { createServer } from "node:http";

import { customAlphabet } from "nanoid";

import type { Config } from "../config/index.js";
import { DI } from "../di.js";
import type { ILogger } from "../log/index.js";
import { Logger } from "../log/index.js";
import version from "../version.js";
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

  #start = Math.round(new Date().valueOf() / 1000);
  #id = nanoid();

  /**
   * Launches health checker - simple web server
   */
  public launch(): void {
    if (this.config.optimistic) {
      return;
    }

    const server = createServer(async (req, res) => {
      // Routing
      if (req.url === "/") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            start_time: this.#start,
            block_number: this.scanner.lastUpdated,
            version,
          }),
        );
      } else if (req.url === "/metrics") {
        try {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end(this.#metrics());
        } catch (ex) {
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

    process.on("SIGTERM", () => {
      this.log.info("terminating");
      server.close();
    });

    this.log.info("launched");
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
}
