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
  /**
   *
   * @param ca
   * @param redstoneTokens
   * @returns true is account was successfully liquidated
   */
  liquidateOptimistic: (
    ca: CreditAccountData,
    redstoneTokens: string[],
  ) => Promise<boolean>;
}
