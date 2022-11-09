import {
  Logger as TSLogger,
  LoggerWithoutCallSite,
  TLogLevelName,
} from "tslog";
import { Container } from "typedi";

const DEV = process.env.NODE_ENV !== "production";

const LoggerClass = DEV ? TSLogger : LoggerWithoutCallSite;

export function Logger(label?: string): PropertyDecorator {
  return (target: any, propertyKey): any => {
    const propertyName = propertyKey ? propertyKey.toString() : "";
    Container.registerHandler({
      object: target,
      propertyName,
      value: () =>
        new LoggerClass({
          type: DEV ? "pretty" : "json",
          ignoreStackLevels: DEV ? 3 : 100,
          hostname: undefined,
          name: label,
          displayFunctionName: false,
          displayLoggerName: false,
          displayFilePath: "hidden",
          minLevel: (process.env.LOG_LEVEL as TLogLevelName) ?? "debug",
          prefix: process.env.UNDERLYING ? [process.env.UNDERLYING] : undefined,
        }),
    });
  };
}

export type LoggerInterface = TSLogger;
