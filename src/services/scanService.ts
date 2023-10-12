import type {
  CreditAccountData,
  CreditAccountHash,
  CreditManagerData,
} from "@gearbox-protocol/sdk";
import {
  CreditAccountWatcher,
  CreditManagerWatcher,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk";
import type { providers } from "ethers";
import { Inject, Service } from "typedi";

import config from "../config";
import { Logger, LoggerInterface } from "../decorators/logger";
import { AMPQService } from "./ampqService";
import { KeyService } from "./keyService";
import type { LiquidatorService } from "./liquidatorService";

@Service()
export class ScanService {
  @Logger("ScanService")
  log: LoggerInterface;

  @Inject()
  ampqService: AMPQService;

  @Inject()
  executorService: KeyService;

  liquidatorService: LiquidatorService;

  protected provider: providers.Provider;
  protected dataCompressor: string;
  protected creditManagers: Record<string, CreditManagerData>;

  protected creditAccounts: Record<string, CreditAccountData> = {};

  protected _lastUpdated = 0;
  protected _isUpdating = false;

  get lastUpdated(): number {
    return this._lastUpdated;
  }

  /**
   * Launches ScanService
   * @param dataCompressor Address of DataCompressor
   * @param provider Ethers provider or signer
   * @param liquidatorService Liquidation service
   */
  async launch(
    dataCompressor: string,
    provider: providers.Provider,
    liquidatorService: LiquidatorService,
  ) {
    this.provider = provider;
    this.liquidatorService = liquidatorService;
    this.dataCompressor = dataCompressor;

    const startingBlock = await this.provider.getBlockNumber();

    this.creditManagers = await CreditManagerWatcher.getV2CreditManagers(
      this.dataCompressor,
      this.provider,
      startingBlock,
    );
    this.log.debug(
      `Detected ${
        Object.entries(this.creditManagers).length
      } credit managers total`,
    );
    this.creditManagers = Object.fromEntries(
      Object.entries(this.creditManagers).filter(([_, cm]) => {
        // If single CreditManager mode is on, use only this manager
        const symb = tokenSymbolByAddress[cm.underlyingToken];
        return (
          !config.underlying ||
          config.underlying.toLowerCase() === symb.toLowerCase()
        );
      }),
    );

    const reqs = Object.values(this.creditManagers).map(async cm =>
      CreditAccountWatcher.getOpenAccounts(cm, this.provider, startingBlock),
    );

    this.log.debug(`Getting opened accounts on ${reqs.length} credit managers`);
    const accountsToUpdate: Array<Array<CreditAccountHash>> =
      await Promise.all(reqs);

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
          const logs = await this.provider.getLogs({
            fromBlock: this._lastUpdated + 1,
            toBlock: blockNum,
          });

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
          this.log.error(`Errors during update blocks ${range}\n${e}`);
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
          this.log.error(`Cant get block number \n${e}`);
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

    let chunkSize = accounts.length;
    let repeat = true;
    while (repeat) {
      try {
        const data = await CreditAccountWatcher.batchCreditAccountLoad(
          accounts,
          this.dataCompressor,
          this.provider,
          { atBlock, chunkSize },
        );

        data.forEach(ca => {
          this.creditAccounts[ca.hash()] = ca;
        });

        repeat = false;
      } catch (e) {
        chunkSize = Math.floor(chunkSize / 2);
        this.log.debug(`Reduce chunkSize to${chunkSize}`);
        if (chunkSize < 2) {
          this.log.error(
            `Cant get credit accounts using batch request at block ${atBlock}\nAccounts:\n${accounts.join(
              "\n",
            )}\n${e}`,
          );

          repeat = false;
        }
      }

      const accountsToLiquidate = Object.values(this.creditAccounts).filter(
        ca =>
          config.optimisticLiquidations ||
          (ca.healthFactor < config.hfThreshold && !ca.isDeleting),
      );

      this.log.debug(`Account to liquidate: ${accountsToLiquidate.length}`);

      if (accountsToLiquidate.length) {
        if (config.optimisticLiquidations) {
          await this.liquidateOptimistically(accountsToLiquidate);
        } else {
          await this.liquidateNormal(accountsToLiquidate);
        }
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
      this.log.warn("No vacant executors at the moment!");
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
    for (let i = 0; i < accountsToLiquidate.length; i++) {
      const ca = accountsToLiquidate[i];
      await this.liquidatorService.liquidateOptimistic(
        ca,
        this.creditManagers[ca.creditManager].creditFacade,
      );
      this.log.info(
        `Optimistic liquidation progress: ${i + 1}/${
          accountsToLiquidate.length
        }`,
      );
    }
  }
}
