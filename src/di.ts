import { ContainerInstance } from "di-at-home";

const Injectables = {
  AddressProvider: "AddressProvider",
  Client: "Client",
  Config: "Config",
  Docker: "Docker",
  HealthChecker: "HealthChecker",
  Liquidator: "Liquidator",
  Logger: "Logger",
  Notifier: "Notifier",
  OptimisticResults: "OptimisticResults",
  Oracle: "Oracle",
  Output: "Output",
  Redstone: "Redstone",
  Scanner: "Scanner",
  Swapper: "Swapper",
} as const;

export const DI = Object.assign(
  new ContainerInstance<{
    AddressProvider: [];
    Client: [];
    Config: [];
    Docker: [];
    HealthChecker: [];
    Liquidator: [];
    Logger: [string];
    Notifier: [];
    OptimisticResults: [];
    Oracle: [];
    Output: [];
    Redstone: [];
    Scanner: [];
    Swapper: [];
  }>(),
  Injectables,
);
