import type { CreditAccountData } from "@gearbox-protocol/sdk";
import type { PriceOnDemandStruct } from "@gearbox-protocol/sdk/lib/types/IDataCompressorV3_00";
import type { providers } from "ethers";

export interface ILiquidatorService {
  launch: (provider: providers.Provider) => Promise<void>;
  liquidate: (
    ca: CreditAccountData,
    priceUpdates: PriceOnDemandStruct[],
  ) => Promise<void>;
  liquidateOptimistic: (
    ca: CreditAccountData,
    priceUpdates: PriceOnDemandStruct[],
  ) => Promise<void>;
}
