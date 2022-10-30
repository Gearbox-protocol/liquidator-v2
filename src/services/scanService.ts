import {
  CreditAccountData,
  CreditAccountHash,
  CreditAccountWatcher,
  CreditManagerData,
  CreditManagerWatcher,
  IPoolService__factory,
  MCall,
  multicall,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk";
import { IPoolServiceInterface } from "@gearbox-protocol/sdk/lib/types/@gearbox-protocol/core-v2/contracts/interfaces/IPoolService.sol/IPoolService";
import { BigNumber, BigNumberish, providers } from "ethers";
import { Inject, Service } from "typedi";

import config from "../config";
import { Logger, LoggerInterface } from "../decorators/logger";
import { AMPQService } from "./ampqService";
import { KeyService } from "./keyService";
import { LiquidatorService } from "./liquidatorService";
import { PriceOracleService } from "./priceOracleService";

@Service()
export class ScanService {
  @Logger("ScanService")
  log: LoggerInterface;

  @Inject()
  oracleService: PriceOracleService;

  @Inject()
  ampqService: AMPQService;

  @Inject()
  executorService: KeyService;

  liquidatorService: LiquidatorService;

  protected provider: providers.Provider;
  protected dataCompressor: string;
  protected creditManagers: Record<string, CreditManagerData>;

  protected ci: Record<string, BigNumber> = {};
  protected creditAccounts: Record<string, CreditAccountData> = {};

  protected _lastUpdated = 0;
  protected _isUpdating = false;

  get lastUpdated(): number {
    return this._lastUpdated;
  }

  /**
   * Launches ScanService
   * @param dataCompressor Address of DataCompressor
   * @param priceOracle Address of PriceOracle
   * @param provider Ethers provider or signer
   * @param liquidatorService Liquidation service
   */
  async launch(
    dataCompressor: string,
    priceOracle: string,
    provider: providers.Provider,
    liquidatorService: LiquidatorService,
  ) {
    this.provider = provider;
    this.liquidatorService = liquidatorService;

    await this.oracleService.launch(priceOracle, this.provider);

    this.dataCompressor = dataCompressor;

    const startingBlock = await this.provider.getBlockNumber();

    this.creditManagers = await CreditManagerWatcher.getV2CreditManagers(
      this.dataCompressor,
      this.provider,
    );

    await this.updatePoolsCI();

    const reqs = Object.values(this.creditManagers)
      .filter(cm => {
        // If single CreditManager mode is on, use only this manager
        const symb = tokenSymbolByAddress[cm.underlyingToken];
        return (
          !config.underlying ||
          config.underlying.toLowerCase() === symb.toLowerCase()
        );
      })
      .map(async cm =>
        CreditAccountWatcher.getOpenAccounts(cm, this.provider, startingBlock),
      );

    this.log.debug(`Getting opened accounts on ${reqs.length} credit managers`);
    const accountsToUpdate: Array<Array<CreditAccountHash>> = await Promise.all(
      reqs,
    );

    await this.updateAccounts(accountsToUpdate.flat(), startingBlock);

    this._lastUpdated = startingBlock;

    if (!config.optimisticLiquidations) {
      this.provider.on("block", async num => await this.on(num));
    }
  }

  //
  // ON BLOCK LOOP
  //
  protected async on(blockNumber: number) {
    let blockNum = blockNumber;
    if (!this._isUpdating && blockNum > this._lastUpdated + config.skipBlocks) {
      this._isUpdating = true;

      let range = "";

      while (this._isUpdating) {
        range = `[${this._lastUpdated + 1} : ${blockNum}]`;
        this.log.info(`Block update ${range}`);
        try {
          const [logs] = await Promise.all([
            this.provider.getLogs({
              fromBlock: this._lastUpdated + 1,
              toBlock: blockNum,
            }),
            this.oracleService.updatePrices(),
            this.updatePoolsCI(),
          ]);

          if (
            CreditManagerWatcher.detectConfigChanges(
              logs,
              Object.values(this.creditManagers),
            )
          ) {
            this.creditManagers =
              await CreditManagerWatcher.getV2CreditManagers(
                this.dataCompressor,
                this.provider,
                blockNum,
              );
          }

          const updates = CreditAccountWatcher.detectChanges(
            logs,
            Object.values(this.creditManagers),
          );

          [...updates.deleted, ...updates.updated].forEach(req => {
            delete this.creditAccounts[req];
          });

          const directUpdate = CreditAccountWatcher.trackDirectTransfers(
            logs,
            [],
            Object.values(this.creditAccounts),
          );

          const accountsToUpdate = Array.from(
            new Set([...updates.updated, ...directUpdate]),
          );

          await this.updateAccounts(accountsToUpdate, blockNum);

          this._lastUpdated = blockNum;
          this.log.info(`Update blocks ${range} competed`);
        } catch (e) {
          this.ampqService.error(`Errors during update blocks ${range}\n${e}`);
        }

        try {
          // Gets the last block number
          const blockNow = await this.provider.getBlockNumber();

          // Checks if update needed right now. If so, it would set isUpdating and pass while at the beginning
          this._isUpdating = blockNow > blockNum + config.skipBlocks;

          if (this._isUpdating) {
            blockNum = blockNow;
          }
        } catch (e) {
          this.ampqService.error(`Cant get block number \n${e}`);
        }
      }
    }
  }

  /**
   * Loads new data and recompute all health factors
   * @param accounts List of created / modified accounts
   * @param atBlock Fiex block for archive node which is needed to get data
   */
  protected async updateAccounts(
    accounts: Array<CreditAccountHash>,
    atBlock: number,
  ) {
    this.log.info(`Getting data on ${accounts.length} accounts`);
    try {
      const data = await CreditAccountWatcher.batchCreditAccountLoad(
        accounts,
        this.dataCompressor,
        this.provider,
        { atBlock, chunkSize: config.multicallChunkSize },
      );

      data.forEach(ca => {
        this.creditAccounts[ca.hash()] = ca;
      });

      Object.values(this.creditAccounts).forEach(ca => {
        ca.updateHealthFactor(
          this.creditManagers[ca.creditManager],
          this.ci[ca.creditManager],
          this.oracleService.priceOracle,
        );
      });
    } catch (e) {
      this.ampqService.error(
        `Cant get credit accounts using batch request at block ${atBlock}\nAccounts:\n${accounts.join(
          "\n",
        )}\n${e}`,
      );
    }

    const accountsToLiquidate = Object.values(this.creditAccounts).filter(
      ca => ca.healthFactor < config.hfThreshold && !ca.isDeleting,
    );

    if (accountsToLiquidate.length) {
      if (config.optimisticLiquidations) {
        await this.liquidateOptimistically(accountsToLiquidate);
      } else {
        await this.liquidateNormal(accountsToLiquidate);
      }
    }
  }

  /**
   * Liquidate accounts using NORMAL flow
   * @param accountsToLiquidate
   */
  protected async liquidateNormal(
    accountsToLiquidate: Array<CreditAccountData>,
  ) {
    this.log.warn(`Need to liquidate ${accountsToLiquidate.length} accounts: `);
    this.log.debug(accountsToLiquidate.map(ca => ca.hash()).join("\n"));
    const vacantExecutors = this.executorService.vacantQty();

    if (vacantExecutors === 0) {
      this.ampqService.info(`WARN! No vacant executors at the moment!`);
    }

    const itemsToProceed =
      accountsToLiquidate.length < vacantExecutors
        ? accountsToLiquidate.length
        : vacantExecutors;

    for (let i = 0; i < itemsToProceed; i++) {
      const ca = accountsToLiquidate[i];

      ca.isDeleting = true;
      await this.liquidatorService.liquidate(
        ca,
        this.creditManagers[ca.creditManager].creditFacade,
      );
    }
  }

  /**
   * Liquidate accounts using OPTIMISTIC flow
   * @param accountsToLiquidate
   */
  protected async liquidateOptimistically(
    accountsToLiquidate: Array<CreditAccountData>,
  ) {
    this.log.warn(
      `Optimistic liquidation for ${accountsToLiquidate.length} accounts: `,
    );
    this.log.debug(accountsToLiquidate.map(ca => ca.hash()).join("\n"));
    for (let ca of accountsToLiquidate) {
      await this.liquidatorService.liquidateOptimistic(
        ca,
        this.creditManagers[ca.creditManager].creditFacade,
      );
    }
  }

  protected async updatePoolsCI() {
    const calls: Array<MCall<IPoolServiceInterface>> = Object.values(
      this.creditManagers,
    ).map(cm => ({
      address: cm.pool,
      interface: IPoolService__factory.createInterface(),
      method: "calcLinearCumulative_RAY()",
    }));

    try {
      const result = await multicall<Array<BigNumberish>>(calls, this.provider);
      Object.values(this.creditManagers).forEach((cm, num) => {
        this.ci[cm.address] = BigNumber.from(result[num]);
      });
    } catch (e) {
      this.ampqService.error(`Cant get CI for pools\n${e}`);
    }
  }
}
