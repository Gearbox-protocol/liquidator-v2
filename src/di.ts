import { ContainerInstance } from "di-at-home";

const Injectables = {
  Client: "Client",
  Config: "Config",
  CreditAccountService: "CreditAccountService",
  Docker: "Docker",
  HealthChecker: "HealthChecker",
  Liquidator: "Liquidator",
  Logger: "Logger",
  Notifier: "Notifier",
  OptimisticResults: "OptimisticResults",
  Output: "Output",
  Scanner: "Scanner",
  Swapper: "Swapper",
  Transport: "Transport",
  Deleverage: "Deleverage",
} as const;

export const DI = Object.assign(
  new ContainerInstance<{
    AddressProvider: [];
    Client: [];
    Config: [];
    CreditAccountService: [];
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
    Transport: [];
    Deleverage: [];
  }>(),
  Injectables,
);
