import { createServer } from "node:http";

import { Inject, Service } from "typedi";

import config from "../config";
import { Logger, LoggerInterface } from "../log";
import { ScanServiceV3 } from "./scan";

@Service()
export class HealthChecker {
  @Logger("HealthChecker")
  log: LoggerInterface;

  @Inject()
  scanServiceV3: ScanServiceV3;

  #start = Math.round(new Date().valueOf() / 1000);

  /**
   * Launches health checker - simple express server
   */
  public launch(): void {
    if (config.optimisticLiquidations) {
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
            version: config.version,
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

    server.listen(config.port, () => {
      this.log.debug("listening");
    });

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
build_info{version="${config.version}"} 1

# HELP block_number Latest processed block
# TYPE block_number gauge
block_number ${this.scanServiceV3.lastUpdated}

`;
  }
}
