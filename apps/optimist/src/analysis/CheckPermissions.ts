import type { ExecutionReport } from "@gearbox-protocol/liquidator-v2-config";
import { iCreditFacadeV310Abi } from "@gearbox-protocol/sdk/abi/310/generated";
import type { CuratorName } from "@gearbox-protocol/sdk/model";
import { AddressMap, type CreditSuite } from "@gearbox-protocol/sdk/onchain";
import type { Markdown } from "@vlad-yakovlev/telegram-md";
import { md } from "@vlad-yakovlev/telegram-md";
import type { Address } from "viem";
import type { INotification } from "../notifier";
import { marketsForCurator, mdList } from "../utils";
import { AbstractInstanceCheck } from "./AbstractInstanceCheck";
import type { ICheck, LiquidatorInstance } from "./types";

/**
 * If the EOA of this instance is not added to the list of emergency liquidators for some Creadit Manager, the address of this credit manager will be present in this list
 */
interface MissingPermission {
  /**
   * Credit manager address
   */
  address: Address;
  /**
   * Credit manager name
   */
  name: string;
}

interface FailedInstance {
  instance: LiquidatorInstance;
  missing: MissingPermission[];
}

/**
 * Checks if liquidator instance has emergency liquidation permissions on all credit managers
 *
 */
export class CheckPermissions extends AbstractInstanceCheck implements ICheck {
  public readonly name = "instance-permissions";
  // [instance.address][creditFacade.address] -> boolean
  #canLiquidateWhilePaused = new AddressMap<AddressMap<boolean>>();

  async check(
    _report: ExecutionReport,
    curator?: CuratorName,
  ): Promise<INotification | undefined> {
    if (curator) {
      return undefined;
    }

    const failed: FailedInstance[] = [];
    for (const instance of this.instances) {
      const missing = await this.#analyzePermissions(instance);
      if (missing?.length) {
        failed.push({ instance, missing });
      }
    }
    if (failed.length) {
      return new CheckPermissionsFail(failed);
    }
  }

  async #analyzePermissions(
    instance: LiquidatorInstance,
  ): Promise<MissingPermission[] | undefined> {
    const shouldHaveEmergencyPermissions =
      !!this.config.liquidators[instance.id]?.addresses[instance.address]
        ?.emergency;

    if (!shouldHaveEmergencyPermissions) {
      return;
    }

    const { address } = instance;
    await this.#loadCanLiquidateWhilePaused(address);
    const result: MissingPermission[] = [];
    const cms = this.#creditSuites();
    for (const { creditFacade, creditManager } of cms) {
      const canLiquidateWhilePaused = !!this.#canLiquidateWhilePaused
        .get(address)
        ?.get(creditFacade.address);
      if (!canLiquidateWhilePaused) {
        result.push({
          address: creditManager.address,
          name: creditManager.name,
        });
      }
    }

    return result;
  }

  async #loadCanLiquidateWhilePaused(instance: Address): Promise<void> {
    const instanceMap =
      this.#canLiquidateWhilePaused.get(instance) ?? new AddressMap<boolean>();
    const facades = this.#creditSuites()
      .map(m => m.creditFacade.address)
      .filter(f => !instanceMap.has(f));
    if (facades.length) {
      const resp = await this.sdk.client.multicall({
        contracts: facades.map(
          f =>
            ({
              abi: iCreditFacadeV310Abi,
              address: f,
              functionName: "canLiquidateWhilePaused",
              args: [instance],
            }) as const,
        ),
        allowFailure: true,
      });
      for (let i = 0; i < resp.length; i++) {
        const item = resp[i];
        instanceMap.upsert(facades[i], item.result === true);
      }
    }
    this.#canLiquidateWhilePaused.upsert(instance, instanceMap);
  }

  #creditSuites(curator?: CuratorName): CreditSuite[] {
    if (curator) {
      return (
        marketsForCurator(this.sdk, curator)?.flatMap(m => m.creditManagers) ??
        []
      );
    }
    return this.sdk.marketRegister.creditManagers;
  }
}

export class CheckPermissionsFail implements INotification {
  public readonly severe = false;
  public readonly instances: FailedInstance[];

  constructor(instances: FailedInstance[]) {
    this.instances = instances;
  }

  public get md(): Markdown {
    return md.join(
      [
        md`Some instances are missing permissions:`,
        mdList(this.instances.map(i => this.#instanceToMd(i))),
      ],
      "\n",
    );
  }

  #instanceToMd(i: FailedInstance): Markdown {
    return md`Liquidator ${md.bold(
      i.instance.address,
    )} has no emergency permissions on ${md.join(
      i.missing.map(p => md`${p.name}`),
      ", ",
    )}`;
  }
}
