import type { CreditAccountData } from "@gearbox-protocol/sdk";
import type { providers } from "ethers";
import { Inject } from "typedi";

import config from "../../config";
import type { LoggerInterface } from "../../log";
import { AddressProviderService } from "../AddressProviderService";
import { KeyService } from "../keyService";
import type { ILiquidatorService } from "../liquidate";
import { RedstoneService } from "../redstoneService";

export default abstract class AbstractScanService extends RedstoneService {
  log: LoggerInterface;

  @Inject()
  executorService: KeyService;

  @Inject()
  addressProvider: AddressProviderService;

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
    accountsToLiquidate: CreditAccountData[],
    redstoneTokens: string[] = [],
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
      await this.liquidatorService.liquidate(ca, redstoneTokens);
    }
  }

  /**
   * Liquidate accounts using OPTIMISTIC flow
   * @param accountsToLiquidate
   */
  protected async liquidateOptimistically(
    accountsToLiquidate: CreditAccountData[],
    redstoneTokens: string[] = [],
  ): Promise<void> {
    const total = accountsToLiquidate.length;
    this.log.info(`Optimistic liquidation for ${total} accounts`);
    for (let i = 0; i < total; i++) {
      const acc = accountsToLiquidate[i];
      const success = await this.liquidatorService.liquidateOptimistic(
        acc,
        redstoneTokens,
      );
      const status = success ? "OK" : "FAIL";
      const msg = `[${i + 1}/${total}] ${acc.addr} in ${acc.creditManager} ${status}`;
      if (success) {
        this.log.info(msg);
      } else {
        this.log.warn(msg);
      }
    }
  }
}
