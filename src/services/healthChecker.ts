import formatDuration from "date-fns/formatDuration";
import intervalToDuration from "date-fns/intervalToDuration";
import express from "express";
import { Gauge, register } from "prom-client";
import { Inject, Service } from "typedi";

import config from "../config";
import { Logger, LoggerInterface } from "../log";
import { ScanServiceV2, ScanServiceV3 } from "./scan";

@Service()
export class HealthChecker {
  @Logger("HealthChecker")
  log: LoggerInterface;

  @Inject()
  scanServiceV2: ScanServiceV2;
  @Inject()
  scanServiceV3: ScanServiceV3;

  /**
   * Launches health checker - simple express server
   */
  public launch(): void {
    if (config.optimisticLiquidations) {
      return;
    }
    const start = new Date();
    const app = express();

    const latestBlockGauge = new Gauge({
      name: "eth_block_number",
      help: "Latest processed block",
    });
    const startTimeGauge = new Gauge({
      name: "start_time",
      help: "Start time, in unixtime",
    });
    startTimeGauge.set(Math.round(start.valueOf() / 1000));
    // pseudo-metric that provides metadata about the running binary
    const buildInfo = new Gauge({
      name: "liquidator_ts_build_info",
      help: "Build info",
      labelNames: ["version"],
    });
    buildInfo.set({ version: config.version }, 1);

    app.get("/", (_, res) => {
      res.send({
        latestBlockV2: this.scanServiceV2.lastUpdated,
        latestBlockV3: this.scanServiceV3.lastUpdated,
        uptime: formatDuration(intervalToDuration({ start, end: new Date() })),
      });
    });
    app.get("/metrics", async (_, res) => {
      try {
        const lastUpdated = Math.min(
          ...[
            this.scanServiceV2.lastUpdated,
            this.scanServiceV3.lastUpdated,
          ].filter(Boolean),
        );
        latestBlockGauge.set(isFinite(lastUpdated) ? lastUpdated : 0);
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
