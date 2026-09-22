import { AddressMap, SDKConstruct } from "@gearbox-protocol/sdk/onchain";
import type { Address } from "viem";
import { DI } from "../../../di.js";
import { type ILogger, Logger } from "../../../log/index.js";
import type { DeployReport } from "../DeployReport.js";
import type {
  IPartialLiqudatorContractFactory,
  IPartialLiquidatorContract,
} from "./types.js";
import {
  AAVELiquidatorV310Contract,
  AaveFrxUSDLiquidatorV310Contract,
  GHOLiquidatorV310Contract,
  MorphoLiquidatorV310Contract,
  SiloLiquidatorV310Contract,
} from "./v310/index.js";

const FACTORIES: IPartialLiqudatorContractFactory[] = [
  AAVELiquidatorV310Contract,
  AaveFrxUSDLiquidatorV310Contract,
  GHOLiquidatorV310Contract,
  MorphoLiquidatorV310Contract,
  SiloLiquidatorV310Contract,
];

export class PartialContractsDeployer extends SDKConstruct {
  @Logger("PartialContractsDeployer")
  // @ts-expect-error
  logger!: ILogger;

  @DI.Inject(DI.DeployReport)
  report!: DeployReport;
  /**
   * mapping of credit manager address to deployed partial liquidator
   */
  #liquidatorForCM = new AddressMap<IPartialLiquidatorContract>();
  /**
   * deduplicate liquidator contracts by name
   **/
  #uniqueContracts: Record<string, IPartialLiquidatorContract> = {};

  public async syncState(): Promise<void> {
    await this.#createInstances();
    for (const contract of this.#liquidatorForCM.values()) {
      await contract.syncState();
    }
  }

  async #createInstances(): Promise<void> {
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
        liquidatorForCM =
          this.#uniqueContracts[liquidatorForCM.name] ?? liquidatorForCM;
        this.#uniqueContracts[liquidatorForCM.name] = liquidatorForCM;
        await this.#uniqueContracts[
          liquidatorForCM.name
        ].queueCreditManagerRegistration(cm);
        this.#liquidatorForCM.upsert(cm.creditManager.address, liquidatorForCM);
        this.logger?.debug(
          `will use partial liquidator contract for ${cm.creditManager.name}: ${liquidatorForCM.name}`,
        );
      } else {
        this.logger?.warn(
          `could not find partial liquidator contract for ${cm.creditManager.name} (v${cm.creditManager.version})`,
        );
        this.report.recordCreditManager({
          creditManager: cm.creditManager.name,
          address: cm.creditManager.address,
          registration: "unsupported",
        });
      }
    }
  }

  public getLiquidatorForCM(
    cm: Address,
  ): IPartialLiquidatorContract | undefined {
    return this.#liquidatorForCM.get(cm);
  }
}
