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
   * Liquidate accounts using OPTIMISTIC flow
   * @param accountsToLiquidate
   */
  protected async liquidateOptimistically(
    accounts: CreditAccountData[],
  ): Promise<void> {}
}
