import formatDuration from "date-fns/formatDuration";
import intervalToDuration from "date-fns/intervalToDuration";
import express from "express";
import { Gauge, register } from "prom-client";
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

    const latestBlockGauge = new Gauge({
      name: "latest_block",
      help: "Latest processed block",
    });
    const startTimeGauge = new Gauge({
      name: "start_time",
      help: "Start time, in unixtime",
    });
    startTimeGauge.set(start.valueOf());
    const healthyGauge = new Gauge({
      name: "healthy",
      help: "Is service healthy",
    });
    healthyGauge.set(1);

    app.get("/", (_, res) => {
      res.send({
        latestBlock: this.scanService.lastUpdated,
        uptime: formatDuration(intervalToDuration({ start, end: new Date() })),
      });
    });
    app.get("/metrics", async (_, res) => {
      try {
        latestBlockGauge.set(this.scanService.lastUpdated);
        res.set("Content-Type", register.contentType);
        res.end(await register.metrics());
      } catch (ex) {
        res.status(500).end(ex);
      }
    });

    app.listen(config.port, () => {
      this.log.info(`started on port ${config.port}`);
    });
  }
}
