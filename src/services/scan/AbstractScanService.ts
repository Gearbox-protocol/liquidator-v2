import { Provider } from "ethers";
import { Inject } from "typedi";

import { CONFIG, type ConfigSchema } from "../../config";
import type { LoggerInterface } from "../../log";
import { PROVIDER } from "../../utils";
import type { CreditAccountData } from "../../utils/ethers-6-temp";
import { AddressProviderService } from "../AddressProviderService";
import type { ILiquidatorService } from "../liquidate";
import { OptimisticResults } from "../liquidate/OptimisiticResults";

export default abstract class AbstractScanService {
  log: LoggerInterface;

  @Inject(CONFIG)
  config: ConfigSchema;

  @Inject()
  addressProvider: AddressProviderService;

  @Inject()
  optimistic: OptimisticResults;

  @Inject(PROVIDER)
  provider: Provider;

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
    if (this.config.optimistic) {
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
      await this.liquidatorService.liquidate(ca);
    }
  }

  /**
   * Liquidate accounts using OPTIMISTIC flow
   * @param accountsToLiquidate
   */
  protected async liquidateOptimistically(
    accounts: CreditAccountData[],
  ): Promise<void> {
    const total = accounts.length;
    const debugS = this.config.debugAccounts ? "selective " : " ";
    this.log.info(`${debugS}optimistic liquidation for ${total} accounts`);

    for (let i = 0; i < total; i++) {
      const acc = accounts[i];
      const result = await this.liquidatorService.liquidateOptimistic(acc);
      const status = result.isError ? "FAIL" : "OK";
      const msg = `[${i + 1}/${total}] ${acc.addr} in ${acc.creditManager} ${status}`;
      if (result.isError) {
        this.log.warn(msg);
      } else {
        this.log.info(msg);
      }
    }
    const success = this.optimistic.get().filter(r => !r.isError).length;
    this.log.info(
      `optimistic liquidation finished: ${success}/${total} accounts liquidated`,
    );
  }
}
