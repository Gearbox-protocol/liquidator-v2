import { Container } from "typedi";

import winston, { Logger as WinstonLogger } from "winston";

export function Logger(label?: string): PropertyDecorator {
  return (target: any, propertyKey): any => {
    const propertyName = propertyKey ? propertyKey.toString() : "";
    Container.registerHandler({
      object: target,
      propertyName,
      value: () => winston.child({ label: label ? `[${label}]` : "" }),
    });
  };
}

export type LoggerInterface = WinstonLogger;
