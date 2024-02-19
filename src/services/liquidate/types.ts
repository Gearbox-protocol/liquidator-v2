import type { CreditAccountData } from "@gearbox-protocol/sdk";
import type { providers } from "ethers";

export interface PriceOnDemand {
  token: string;
  callData: string;
  ts: number;
}

export interface ILiquidatorService {
  launch: (provider: providers.Provider) => Promise<void>;
  liquidate: (ca: CreditAccountData, redstoneTokens: string[]) => Promise<void>;
  liquidateOptimistic: (
    ca: CreditAccountData,
    redstoneTokens: string[],
  ) => Promise<void>;
}
