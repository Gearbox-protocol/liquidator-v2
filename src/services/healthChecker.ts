import express from "express";
import { Service } from "typedi";

import config from "../config";
import { Logger, LoggerInterface } from "../decorators/logger";

@Service()
export class HealthChecker {
  @Logger("HealthChecker")
  log: LoggerInterface;

  /**
   * Launches health checker - simple express server
   */
  launch() {
    const app = express();

    app.get("/", (_, res) => {
      res.send("");
    });

    app.listen(config.port, () => {
      this.log.info(` started on port ${config.port}`);
    });
  }
}
