import { Logger as TSLogger, TLogLevelName } from "tslog";
import { Container } from "typedi";

export function Logger(label?: string): PropertyDecorator {
  return (target: any, propertyKey): any => {
    const propertyName = propertyKey ? propertyKey.toString() : "";
    Container.registerHandler({
      object: target,
      propertyName,
      value: () =>
        new TSLogger({
          name: label,
          displayFunctionName: false,
          displayLoggerName: false,
          displayFilePath: "hidden",
          minLevel: (process.env.LOG_LEVEL as TLogLevelName) ?? "debug",
        }),
    });
  };
}

export type LoggerInterface = TSLogger;
