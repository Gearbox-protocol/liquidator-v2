import config from "../config";
import express from "express";
import { Logger, LoggerInterface } from "../decorators/logger";
import { Service } from "typedi";

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
