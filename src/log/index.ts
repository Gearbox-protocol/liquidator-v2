import type { IFactory } from "di-at-home";
import { createRequire } from "module";
import type { DestinationStream, Logger as ILogger, LoggerOptions } from "pino";
import { pino } from "pino";

const require = createRequire(import.meta.url);

import { DI } from "../di.js";

@DI.Factory(DI.Logger)
class LoggerFactory implements IFactory<ILogger, [string]> {
  #logger: ILogger;

  constructor() {
    const executionId = process.env.EXECUTION_ID?.split(":").pop();
    const options: LoggerOptions = {
      level: process.env.LOG_LEVEL ?? "debug",
      base: { executionId },
      formatters: {
        level: label => {
          return {
            level: label,
          };
        },
      },
      // fluent-bit (which is used in our ecs setup with loki) cannot handle unix epoch in millis out of the box
      timestamp: () => `,"time":${Date.now() / 1000.0}`,
    };
    let stream: DestinationStream | undefined;
    // this label will be dropped by esbuild during production build
    // eslint-disable-next-line no-labels
    DEV: {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pinoPretty = require("pino-pretty");
      stream = pinoPretty({
        colorize: true,
      });
    }
    this.#logger = pino(options, stream);
  }

  public produce(name: string): ILogger {
    return this.#logger.child({ name });
  }
}

export const Logger = (name: string) => DI.Transient(DI.Logger, name);

export type { Logger as ILogger } from "pino";
