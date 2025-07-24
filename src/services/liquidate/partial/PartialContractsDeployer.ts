import { AddressMap, SDKConstruct } from "@gearbox-protocol/sdk";
import type { Address } from "viem";
import { type ILogger, Logger } from "../../../log/index.js";
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
  // v300
  AAVELiquidatorV300Contract,
  GHOLiquidatorV300Contract,
  SiloLiquidatorV300Contract,
  // v310
  AAVELiquidatorV310Contract,
  GHOLiquidatorV310Contract,
  SiloLiquidatorV310Contract,
];

export class PartialContractsDeployer extends SDKConstruct {
  @Logger("Liquidator")
  logger!: ILogger;
  /**
   * mapping of credit manager address to deployed partial liquidator
   */
  #liquidatorForCM = new AddressMap<IPartialLiquidatorContract>();
  /**
   * deduplicate liquidator contracts by name
   **/
  #uniqueContracts: Record<string, IPartialLiquidatorContract> = {};

  public async launch(): Promise<void> {
    const contracts = this.#createInstances();

    for (const contract of contracts) {
      if (!contract.isDeployed) {
        await contract.deploy();
      }
      await contract.configure();
    }
  }

  #createInstances(): IPartialLiquidatorContract[] {
    const result = new Set<IPartialLiquidatorContract>();
    for (const cm of this.sdk.marketRegister.creditManagers) {
      if (this.#liquidatorForCM.has(cm.creditManager.address)) {
        continue;
      }
      const symbol = cm.sdk.tokensMeta.symbol(cm.underlying);
      this.logger?.debug(
        {
          manager: cm.creditManager.name,
          underlying: symbol,
          facadeVersion: cm.creditFacade.version,
          routerVersion: cm.router.version,
        },
        "creating partial liquidator contract",
      );
      let liquidatorForCM: IPartialLiquidatorContract | undefined;

      for (const f of FACTORIES) {
        const liquidator = f.tryAttach(cm);
        if (liquidator) {
          if (liquidatorForCM) {
            throw new Error(
              `multiple liquidators found for credit manager ${this.labelAddress(cm.creditManager.address)}: ${liquidator.name} and ${liquidatorForCM.name}`,
            );
          }
          liquidatorForCM = liquidator;
          // check all factories to make sure it will throw in case of multiple liquidators
        }
      }

      if (liquidatorForCM) {
        this.#uniqueContracts[liquidatorForCM.name] ??= liquidatorForCM;
        this.#uniqueContracts[liquidatorForCM.name].addCreditManager(cm);
        result.add(this.#uniqueContracts[liquidatorForCM.name]);
        this.logger?.debug(
          `will use partial liquidator contract for ${cm.creditManager.name}: ${liquidatorForCM.name}`,
        );
      } else {
        this.logger?.warn(
          `could not find partial liquidator contract for ${cm.creditManager.name}`,
        );
      }
    }

    return Array.from(result);
  }

  public getLiquidatorForCM(
    cm: Address,
  ): IPartialLiquidatorContract | undefined {
    return this.#liquidatorForCM.get(cm);
  }
}
