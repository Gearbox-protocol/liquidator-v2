import type { CreditAccountData } from "@gearbox-protocol/sdk";
import type { providers } from "ethers";
import { Inject } from "typedi";

import config from "../../config";
import type { LoggerInterface } from "../../log";
import { KeyService } from "../keyService";
import type { ILiquidatorService } from "../liquidate";

export default abstract class AbstractScanService {
  log: LoggerInterface;

  @Inject()
  executorService: KeyService;

  protected provider: providers.Provider;

  protected _lastUpdated = 0;

  public get lastUpdated(): number {
    return this._lastUpdated;
  }

  protected abstract get liquidatorService(): ILiquidatorService;

  /**
   * Launches ScanService
   * @param dataCompressor Address of DataCompressor
   * @param provider Ethers provider or signer
   * @param liquidatorService Liquidation service
   */
  public async launch(provider: providers.Provider): Promise<void> {
    this.provider = provider;
    await this.liquidatorService.launch(provider);
    await this._launch(provider);
    if (!config.optimisticLiquidations) {
      this.provider.on("block", async num => await this.onBlock(num));
    }
  }

  protected abstract _launch(provider: providers.Provider): Promise<void>;
  protected abstract onBlock(block: number): Promise<void>;

  /**
   * Liquidate accounts using NORMAL flow
   * @param accountsToLiquidate
   */
  protected async liquidateNormal(
    accountsToLiquidate: Array<CreditAccountData>,
  ): Promise<void> {
    if (!accountsToLiquidate.length) {
      return;
    }
    this.log.warn(`Need to liquidate ${accountsToLiquidate.length} accounts`);
    const vacantExecutors = this.executorService.vacantQty();

    if (vacantExecutors === 0) {
      this.log.warn("No vacant executors at the moment!");
    }

    const itemsToProceed =
      accountsToLiquidate.length < vacantExecutors
        ? accountsToLiquidate.length
        : vacantExecutors;

    for (let i = 0; i < itemsToProceed; i++) {
      const ca = accountsToLiquidate[i];

      ca.isDeleting = true;
      await this.liquidatorService.liquidate(ca);
    }
  }

  /**
   * Liquidate accounts using OPTIMISTIC flow
   * @param accountsToLiquidate
   */
  protected async liquidateOptimistically(
    accountsToLiquidate: Array<CreditAccountData>,
  ): Promise<void> {
    this.log.warn(
      `Optimistic liquidation for ${accountsToLiquidate.length} accounts`,
    );
    for (let i = 0; i < accountsToLiquidate.length; i++) {
      const ca = accountsToLiquidate[i];
      await this.liquidatorService.liquidateOptimistic(ca);
      this.log.info(
        `Optimistic liquidation progress: ${i + 1}/${
          accountsToLiquidate.length
        }`,
      );
    }
  }
}
