import { createServer } from "node:http";

import type { Config } from "../config/index.js";
import { DI } from "../di.js";
import type { ILogger } from "../log/index.js";
import { Logger } from "../log/index.js";
import version from "../version.js";
import type { ScanServiceV3 } from "./scan/index.js";

@DI.Injectable(DI.HealthChecker)
export default class HealthCheckerService {
  @Logger("HealthChecker")
  log!: ILogger;

  @DI.Inject(DI.Scanner)
  scanServiceV3!: ScanServiceV3;

  @DI.Inject(DI.Config)
  config!: Config;

  #start = Math.round(new Date().valueOf() / 1000);

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
            block_number: this.scanServiceV3.lastUpdated,
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
    return `# HELP start_time Start time, in unixtime
# TYPE start_time gauge
start_time ${this.#start}

# HELP build_info Build info
# TYPE build_info gauge
build_info{version="${version}"} 1

# HELP block_number Latest processed block
# TYPE block_number gauge
block_number ${this.scanServiceV3.lastUpdated}

`;
  }
}
