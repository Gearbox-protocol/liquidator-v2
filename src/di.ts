import { ContainerInstance } from "di-at-home";

const Injectables = {
  Client: "Client",
  Config: "Config",
  Deleverage: "Deleverage",
  ErrorHandler: "ErrorHandler",
  HealthChecker: "HealthChecker",
  Liquidator: "Liquidator",
  Logger: "Logger",
  Notifier: "Notifier",
  OptimisticResults: "OptimisticResults",
  Output: "Output",
  Scanner: "Scanner",
  SDK: "SDK",
  Transport: "Transport",
} as const;

export const DI = Object.assign(
  new ContainerInstance<{
    Client: [];
    Config: [];
    Deleverage: [];
    ErrorHandler: [];
    HealthChecker: [];
    Liquidator: [];
    Logger: [string];
    Notifier: [];
    OptimisticResults: [];
    Output: [];
    Scanner: [];
    SDK: [];
    Transport: [];
  }>(),
  Injectables,
);
