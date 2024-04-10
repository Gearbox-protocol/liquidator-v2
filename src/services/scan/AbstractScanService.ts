import type { CreditAccountData } from "@gearbox-protocol/sdk";
import { providers } from "ethers";
import { Inject } from "typedi";

import config from "../../config";
import type { LoggerInterface } from "../../log";
import { AddressProviderService } from "../AddressProviderService";
import type { ILiquidatorService } from "../liquidate";

export default abstract class AbstractScanService {
  log: LoggerInterface;

  @Inject()
  addressProvider: AddressProviderService;

  @Inject()
  provider: providers.Provider;

  protected _lastUpdated = 0;

  public get lastUpdated(): number {
    return this._lastUpdated;
  }

  protected abstract get liquidatorService(): ILiquidatorService;

  /**
   * Launches ScanService
   * @param dataCompressor Address of DataCompressor
   * @param liquidatorService Liquidation service
   */
  public async launch(): Promise<void> {
    await this.liquidatorService.launch();
    await this._launch();
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

  protected abstract _launch(): Promise<void>;
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
    for (const ca of accountsToLiquidate) {
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
