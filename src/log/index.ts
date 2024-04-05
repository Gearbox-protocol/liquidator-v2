import type { Logger } from "pino";
import { pino } from "pino";
import { Container } from "typedi";

const DEV = process.env.NODE_ENV !== "production";
const underlying = process.env.UNDERLYING;
const executionId = process.env.EXECUTION_ID?.split(":").pop();

function getLogger(name?: string): LoggerInterface {
  return pino({
    name,
    transport: DEV
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
          },
        }
      : undefined,
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

export type LoggerInterface = Logger;
