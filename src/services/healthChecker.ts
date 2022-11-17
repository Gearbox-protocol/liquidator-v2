import formatDuration from "date-fns/formatDuration";
import intervalToDuration from "date-fns/intervalToDuration";
import express from "express";
import { Inject, Service } from "typedi";

import config from "../config";
import { Logger, LoggerInterface } from "../decorators/logger";
import { ScanService } from "./scanService";

@Service()
export class HealthChecker {
  @Logger("HealthChecker")
  log: LoggerInterface;

  @Inject()
  scanService: ScanService;

  /**
   * Launches health checker - simple express server
   */
  launch() {
    const start = new Date();
    const app = express();

    app.get("/", (_, res) => {
      res.send({
        latestBlock: this.scanService.lastUpdated,
        uptime: formatDuration(intervalToDuration({ start, end: new Date() })),
      });
    });

    app.listen(config.port, () => {
      this.log.info(`started on port ${config.port}`);
    });
  }
}
