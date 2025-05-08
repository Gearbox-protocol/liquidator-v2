import type { IFactory } from "di-at-home";
import type { Logger as ILogger } from "pino";
import { pino } from "pino";

import { DI } from "../di.js";

@DI.Factory(DI.Logger)
class LoggerFactory implements IFactory<ILogger, [string]> {
  #logger: ILogger;

  constructor() {
    const executionId = process.env.EXECUTION_ID?.split(":").pop();
    this.#logger = pino({
      level: process.env.LOG_LEVEL ?? "debug",
      base: { executionId },
      formatters: {
        bindings: () => ({}),
        level: label => {
          return {
            level: label,
          };
        },
      },
      // fluent-bit (which is used in our ecs setup with loki) cannot handle unix epoch in millis out of the box
      timestamp: () => `,"time":${Date.now() / 1000.0}`,
    });
  }

  public produce(name: string): ILogger {
    return this.#logger.child({ name });
  }
}

export const Logger = (name: string) => DI.Transient(DI.Logger, name);

export type { Logger as ILogger } from "pino";
