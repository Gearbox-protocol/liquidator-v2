import type { CreditAccountData } from "@gearbox-protocol/sdk";
import type { providers } from "ethers";

export interface ILiquidatorService {
  launch: (provider: providers.Provider) => Promise<void>;
  liquidate: (ca: CreditAccountData) => Promise<void>;
  liquidateOptimistic: (ca: CreditAccountData) => Promise<void>;
}
