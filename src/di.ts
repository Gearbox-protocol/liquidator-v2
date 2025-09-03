import { ContainerInstance } from "di-at-home";

const Injectables = {
  Client: "Client",
  Config: "Config",
  Docker: "Docker",
  HealthChecker: "HealthChecker",
  Liquidator: "Liquidator",
  Logger: "Logger",
  Notifier: "Notifier",
  OptimisticResults: "OptimisticResults",
  Output: "Output",
  Scanner: "Scanner",
  Swapper: "Swapper",
  CreditAccountService: "CreditAccountService",
  MulticallSpy: "MulticallSpy",
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
    CreditAccountService: [];
    MulticallSpy: [];
  }>(),
  Injectables,
);
