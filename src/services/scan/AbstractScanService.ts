import type { Config } from "../../config/index.js";
import type { CreditAccountData } from "../../data/index.js";
import { DI } from "../../di.js";
import type { ILogger } from "../../log/index.js";
import type { AddressProviderService } from "../AddressProviderService.js";
import type Client from "../Client.js";
import type {
  ILiquidatorService,
  OptimisticResults,
} from "../liquidate/index.js";

export default abstract class AbstractScanService {
  abstract log: ILogger;

  @DI.Inject(DI.Config)
  config!: Config;

  @DI.Inject(DI.AddressProvider)
  addressProvider!: AddressProviderService;

  @DI.Inject(DI.OptimisticResults)
  optimistic!: OptimisticResults;

  @DI.Inject(DI.Client)
  client!: Client;

  protected _lastUpdated = 0n;

  public get lastUpdated(): bigint {
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
    this.client.pub.watchBlockNumber({
      onBlockNumber: n => this.onBlock(n),
    });
  }

  protected abstract _launch(): Promise<void>;
  protected abstract onBlock(block: bigint): Promise<void>;

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
