import type { CreditAccountData } from "@gearbox-protocol/sdk";
import type { providers } from "ethers";

export interface PriceOnDemand {
  token: string;
  callData: string;
}

export interface ILiquidatorService {
  launch: (provider: providers.Provider) => Promise<void>;
  liquidate: (
    ca: CreditAccountData,
    priceUpdates: PriceOnDemand[],
  ) => Promise<void>;
  liquidateOptimistic: (
    ca: CreditAccountData,
    priceUpdates: PriceOnDemand[],
  ) => Promise<void>;
}
