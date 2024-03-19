import type { CreditAccountData } from "@gearbox-protocol/sdk";
import type { providers } from "ethers";
import { Inject } from "typedi";

import config from "../../config";
import type { LoggerInterface } from "../../log";
import { AddressProviderService } from "../AddressProviderService";
import { KeyService } from "../keyService";
import type { ILiquidatorService } from "../liquidate";

export default abstract class AbstractScanService {
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
    this.subscribeToUpdates();
  }

  protected subscribeToUpdates(): void {
    if (config.optimistic) {
      return;
    }
    if (this.addressProvider.network === "Mainnet") {
      this.provider.on("block", async num => await this.onBlock(num));
      return;
    }
    // on L2 blocks are too frequent
    setInterval(async () => {
      const block = await this.provider.getBlockNumber();
      await this.onBlock(block);
    }, 12_000);
  }

  protected abstract _launch(provider: providers.Provider): Promise<void>;
  protected abstract onBlock(block: number): Promise<void>;

  /**
   * Liquidate accounts using NORMAL flow
   * @param accountsToLiquidate
   */
  protected async liquidateNormal(
    accountsToLiquidate: CreditAccountData[],
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
    accountsToLiquidate: CreditAccountData[],
  ): Promise<void> {
    const accounts = config.debugAccounts
      ? accountsToLiquidate.filter(({ addr }) =>
          config.debugAccounts?.includes(addr),
        )
      : accountsToLiquidate;

    const total = accounts.length;
    const debugS = config.debugAccounts ? "selective " : " ";
    this.log.info(`${debugS}optimistic liquidation for ${total} accounts`);

    for (let i = 0; i < total; i++) {
      const acc = accounts[i];
      const success = await this.liquidatorService.liquidateOptimistic(acc);
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
