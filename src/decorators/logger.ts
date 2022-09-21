import { Logger as TSLogger } from "tslog";
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
        }),
    });
  };
}

export type LoggerInterface = TSLogger;
