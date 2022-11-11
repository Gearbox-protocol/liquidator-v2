import { pino } from "pino";
import { Logger as TSLogger, TLogLevelName } from "tslog";
import { Container } from "typedi";

const DEV = process.env.NODE_ENV !== "production";
const underlying = process.env.UNDERLYING;
// For optimistic liquidators in AWS StepFunctions
const executionId = process.env.EXECUTION_ID?.split(":").pop();

export function Logger(label?: string): PropertyDecorator {
  return (target: any, propertyKey): any => {
    const propertyName = propertyKey ? propertyKey.toString() : "";
    Container.registerHandler({
      object: target,
      propertyName,
      value: () =>
        DEV
          ? new TSLogger({
              type: "pretty",
              hostname: undefined,
              name: label,
              displayFunctionName: false,
              displayLoggerName: false,
              displayFilePath: "hidden",
              minLevel: (process.env.LOG_LEVEL as TLogLevelName) ?? "debug",
              prefix: underlying ? [underlying] : undefined,
            })
          : pino({
              level: process.env.LOG_LEVEL ?? "debug",
              base: { underlying, executionId },
              formatters: {
                level: label => {
                  return {
                    level: label,
                  };
                },
              },
            }),
    });
  };
}

export type LoggerInterface = TSLogger;
