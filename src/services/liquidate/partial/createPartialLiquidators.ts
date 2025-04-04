import type { GearboxSDK } from "@gearbox-protocol/sdk";
import type { Address } from "viem";

import type {
  IPartialLiqudatorContractFactory,
  IPartialLiquidatorContract,
} from "./types.js";
import {
  AAVELiquidatorV300Contract,
  GHOLiquidatorV300Contract,
  SiloLiquidatorV300Contract,
} from "./v300/index.js";
import {
  AAVELiquidatorV310Contract,
  GHOLiquidatorV310Contract,
  SiloLiquidatorV310Contract,
} from "./v310/index.js";

const FACTORIES: IPartialLiqudatorContractFactory[] = [
  AAVELiquidatorV300Contract,
  GHOLiquidatorV300Contract,
  SiloLiquidatorV300Contract,
  AAVELiquidatorV310Contract,
  GHOLiquidatorV310Contract,
  SiloLiquidatorV310Contract,
];

export function createPartialLiquidators(
  sdk: GearboxSDK,
): Record<Address, IPartialLiquidatorContract> {
  // deduplicate liquidator contracts by name
  const uniqueContracts: Record<string, IPartialLiquidatorContract> = {};
  const result: Record<Address, IPartialLiquidatorContract> = {};

  for (const cm of sdk.marketRegister.creditManagers) {
    let liquidatorForCM: IPartialLiquidatorContract | undefined;

    for (const f of FACTORIES) {
      const liquidator = f.tryAttach(cm);
      if (liquidator) {
        if (liquidatorForCM) {
          throw new Error(
            `multiple liquidators found for credit manager ${sdk.provider.addressLabels.get(cm.creditManager.address)}: ${liquidator.name} and ${liquidatorForCM.name}`,
          );
        }
        liquidatorForCM = liquidator;
      }
    }

    if (liquidatorForCM) {
      uniqueContracts[liquidatorForCM.name] ??= liquidatorForCM;
      uniqueContracts[liquidatorForCM.name].addCreditManager(cm);
      result[cm.creditManager.address] = uniqueContracts[liquidatorForCM.name];
    }
  }

  return result;
}
