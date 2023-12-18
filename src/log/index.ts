import { pino } from "pino";
import { Logger as TSLogger } from "tslog";
import { Container } from "typedi";

const DEV = process.env.NODE_ENV !== "production";
const underlying = process.env.UNDERLYING;
// For optimistic liquidators in AWS StepFunctions
const executionId = process.env.EXECUTION_ID?.split(":").pop();

const TS_LOG_LEVELS: Record<string, number> = {
  silly: 0,
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
  fata: 6,
};

export function getLogger(label?: string): LoggerInterface {
  return DEV
    ? new TSLogger({
        type: "pretty",
        name: label,
        minLevel:
          TS_LOG_LEVELS[process.env.LOG_LEVEL?.toLowerCase() ?? "debug"] ?? 3,
        prefix: underlying ? [underlying] : undefined,
        prettyLogTemplate:
          "{{logLevelName}}\t{{nameWithDelimiterPrefix}}\t{{filePathWithLine}}\t",
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
        // fluent-bit (which is used in our ecs setup with loki) cannot handle unix epoch in millis out of the box
        timestamp: () => `,"time":${Date.now() / 1000.0}`,
      });
}

export function Logger(label?: string): PropertyDecorator {
  return (target: any, propertyKey): any => {
    const propertyName = propertyKey ? propertyKey.toString() : "";
    Container.registerHandler({
      object: target,
      propertyName,
      value: () => getLogger(label),
    });
  };
}

export type LoggerInterface = Pick<
  TSLogger<any>,
  "debug" | "info" | "warn" | "error"
>;
