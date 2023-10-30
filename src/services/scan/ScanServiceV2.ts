import type {
  CreditAccountHash,
  CreditManagerData,
  MCall,
} from "@gearbox-protocol/sdk";
import {
  CreditAccountData,
  CreditAccountWatcherV2,
  CreditManagerWatcher,
  IAddressProviderV3__factory,
  IDataCompressorV2_10__factory,
  safeMulticall,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk";
import { ethers, type providers } from "ethers";
import { Inject, Service } from "typedi";

import config from "../../config";
import { Logger, LoggerInterface } from "../../log";
import type { ILiquidatorService } from "../liquidate";
import { LiquidatorServiceV2 } from "../liquidate";
import AbstractScanService from "./AbstractScanService";

@Service()
export class ScanServiceV2 extends AbstractScanService {
  @Logger("ScanServiceV2")
  log: LoggerInterface;

  @Inject()
  liquidarorServiceV2: LiquidatorServiceV2;

  protected dataCompressor: string;
  protected creditManagers: Record<string, CreditManagerData>;
  protected creditAccounts: Record<string, CreditAccountData> = {};

  protected _isUpdating = false;

  protected override get liquidatorService(): ILiquidatorService {
    return this.liquidarorServiceV2;
  }

  protected override async _launch(
    provider: providers.Provider,
  ): Promise<void> {
    const addressProvider = IAddressProviderV3__factory.connect(
      config.addressProvider,
      provider,
    );

    this.dataCompressor = await addressProvider.getAddressOrRevert(
      ethers.utils.formatBytes32String("DATA_COMPRESSOR"),
      210,
    );

    const startingBlock = await provider.getBlockNumber();

    this.creditManagers = await CreditManagerWatcher.getV2CreditManagers(
      this.dataCompressor,
      provider,
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
      CreditAccountWatcherV2.getOpenAccounts(cm, provider, startingBlock),
    );

    this.log.debug(`Getting opened accounts on ${reqs.length} credit managers`);
    const accountsToUpdate: Array<Array<CreditAccountHash>> =
      await Promise.all(reqs);

    await this.updateAccounts(accountsToUpdate.flat(), startingBlock);

    this._lastUpdated = startingBlock;
  }

  protected override async onBlock(blockNumber: number): Promise<void> {
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

          const updates = CreditAccountWatcherV2.detectChanges(
            logs,
            Object.values(this.creditManagers),
          );

          [...updates.deleted, ...updates.updated].forEach(req => {
            delete this.creditAccounts[req];
          });

          const directUpdate = CreditAccountWatcherV2.trackDirectTransfers(
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
  ): Promise<void> {
    this.log.info(
      `Getting data on ${accounts.length} accounts: ${accounts.join(", ")}`,
    );

    let chunkSize = accounts.length;
    let repeat = true;
    while (repeat) {
      try {
        const data = await this.#batchLoadCreditAccounts(
          accounts,
          atBlock,
          chunkSize,
        );
        for (const v of data) {
          if (v.error) {
            this.log.warn(v.error);
          } else if (v.value) {
            this.creditAccounts[v.value.hash()] = v.value;
          }
        }
        repeat = false;
      } catch (e) {
        chunkSize = Math.floor(chunkSize / 2);
        this.log.debug(`Reduce chunkSize to ${chunkSize}`);
        if (chunkSize < 2) {
          this.log.error(
            `Cant get ${accounts.length} credit accounts using batch request at block ${atBlock}: ${e}`,
          );
          repeat = false;
        }
      }

      const accountsToLiquidate = Object.values(this.creditAccounts).filter(
        ca =>
          config.optimisticLiquidations ||
          (ca.healthFactor < config.hfThreshold && !ca.isDeleting),
      );

      this.log.debug(`Accounts to liquidate: ${accountsToLiquidate.length}`);

      if (accountsToLiquidate.length) {
        if (config.optimisticLiquidations) {
          await this.liquidateOptimistically(accountsToLiquidate);
        } else {
          await this.liquidateNormal(accountsToLiquidate);
        }
      }
    }
  }

  async #batchLoadCreditAccounts(
    accounts: CreditAccountHash[],
    blockTag: number,
    chunkSize: number,
  ): Promise<Array<{ error?: Error; value?: CreditAccountData }>> {
    const dcInterface = IDataCompressorV2_10__factory.createInterface();

    const calls: MCall<typeof dcInterface>[][] = [];

    let i = 0;
    while (i * chunkSize < accounts.length) {
      const chunk = accounts.slice(i * chunkSize, (i + 1) * chunkSize);
      calls[i] = chunk.map(c => {
        return {
          method: "getCreditAccountData(address,address)",
          params: c.split(":"),
          address: this.dataCompressor,
          interface: dcInterface,
        };
      });
      i++;
    }

    const results: Array<{ error?: Error; value?: CreditAccountData }> = [];

    for (let c of calls) {
      const result = await safeMulticall(c, this.provider, {
        blockTag,
        gasLimit: 30e6,
      });
      results.push(
        ...result.map((v, i) => ({
          error: v.error
            ? new Error(`${c[i].params} failed: ${v.error}`)
            : undefined,
          value: v.value ? new CreditAccountData(v.value) : undefined,
        })),
      );
    }

    return results;
  }
}
