import type { INotificationService } from "@gearbox-protocol/cli-utils";
import type {
  CreditAccountData,
  GetCreditAccountsOptions,
  ICreditAccountsService,
  OnchainSDK,
} from "@gearbox-protocol/sdk";
import {
  AddressSet,
  MAX_UINT256,
  PERCENTAGE_FACTOR,
  WAD,
  watchBlocksAsync,
} from "@gearbox-protocol/sdk";
import type { Address, Block } from "viem";
import type { Config } from "../config/index.js";
import { DI } from "../di.js";
import { type ILogger, Logger } from "../log/index.js";
import type Client from "./Client.js";
import type DeleverageService from "./DeleverageService.js";
import type { ILiquidatorService } from "./liquidate/index.js";
import { ZeroHFAccountsNotification } from "./notifier/ZeroHFAccountsNotification.js";

@DI.Injectable(DI.Scanner)
export class Scanner {
  @Logger("Scanner")
  log!: ILogger;

  @DI.Inject(DI.Config)
  config!: Config;

  @DI.Inject(DI.Client)
  client!: Client;

  @DI.Inject(DI.Liquidator)
  liquidatorService!: ILiquidatorService;

  @DI.Inject(DI.CreditAccountService)
  caService!: ICreditAccountsService;

  @DI.Inject(DI.Deleverage)
  deleverage!: DeleverageService;

  @DI.Inject(DI.Notifier)
  notifier!: INotificationService;

  #lastUpdated = 0n;
  #maxHealthFactor = MAX_UINT256;
  #minHealthFactor = 0n;
  #unwatch?: () => void;
  #liquidatableAccounts = 0;

  public async launch(): Promise<void> {
    await this.liquidatorService.launch();

    const block = await this.client.pub.getBlock();

    this.#maxHealthFactor = this.config.optimistic
      ? MAX_UINT256 // to discover account with underlying only, whose HF are not affected by zero-let script
      : this.config.hfThreshold;
    this.#minHealthFactor = this.config.optimistic ? 0n : 1n;

    if (this.config.liquidationMode === "full") {
      if (this.config.optimistic && this.config.useProductionScanner) {
        this.#minHealthFactor = 1n;
        this.#maxHealthFactor = this.config.hfThreshold;
      }
    }

    if (this.config.liquidationMode === "partial") {
      if (this.config.optimistic) {
        this.#maxHealthFactor = MAX_UINT256;
      }
    }

    if (this.config.liquidationMode === "deleverage") {
      if (this.deleverage.bots.length === 0) {
        this.log.error("no deleverage bots found");
        // will hang indefinitely
        return;
      }
      if (this.config.optimistic && !this.config.useProductionScanner) {
        this.#minHealthFactor = 0n;
        this.#maxHealthFactor = MAX_UINT256;
      } else {
        // TODO: support multiple bots
        this.#minHealthFactor = WAD;
        this.#maxHealthFactor =
          (BigInt(this.deleverage.bot.minHealthFactor) * WAD) /
          PERCENTAGE_FACTOR;
      }
    }

    this.log.info(
      {
        min: this.#minHealthFactor,
        max:
          this.#maxHealthFactor === MAX_UINT256
            ? "MAX_UINT256"
            : this.#maxHealthFactor,
      },
      "final health factor range",
    );

    // we should not pin block during optimistic liquidations
    // because during optimistic liquidations we need to call evm_mine to make redstone work
    await this.#updateAccounts(
      this.config.optimistic ? undefined : block.number,
    );
    if (!this.config.optimistic) {
      this.#unwatch = watchBlocksAsync(this.client.pub, {
        onBlock: b => this.#onBlock(b),
      });
    }
  }

  async #onBlock(block: Block<bigint, false, "latest">): Promise<void> {
    const { number: blockNumber, timestamp } = block;
    try {
      const ok = await this.sdk.syncState({
        blockNumber,
        timestamp,
        // this effectively updates chainlink prices
        // we don't need this
        // if there're new price feeds, syncState will pick them up anyway
        // and redstone price updates will be updated in credit account service calls
        ignoreUpdateablePrices: true,
      });
      if (ok) {
        await this.liquidatorService.syncState(this.sdk.currentBlock);
        await this.#updateAccounts(this.sdk.currentBlock);
        this.#lastUpdated = this.sdk.currentBlock;
      }
    } catch (e) {
      this.log.error(
        new Error(`failed to process block ${blockNumber}`, { cause: e }),
      );
      // this.#lastUpdated will not change in case of failed block
      // if this happens for multiple blocks, this error should be caught by metrics monitor, since lastUpdated metric will be stagnant
    }
  }

  /**
   * Loads new data and recompute all health factors
   * @param blockNumber Fixed block for archive node which is needed to get data
   */
  async #updateAccounts(blockNumber?: bigint): Promise<void> {
    const start = Date.now();
    const blockS = blockNumber ? ` in ${blockNumber}` : "";
    let accounts: CreditAccountData[] = [];
    if (this.config.debugAccount) {
      const acc = await this.caService.getCreditAccountData(
        this.config.debugAccount,
        blockNumber,
      );
      accounts = acc ? [acc] : [];
    } else {
      const queue: GetCreditAccountsOptions = {
        minHealthFactor: this.#minHealthFactor,
        maxHealthFactor: this.#maxHealthFactor,
        includeZeroDebt: false,
        creditManager: this.config.debugManager,
        ignoreReservePrices:
          this.config.liquidationMode !== "deleverage" &&
          !this.config.updateReservePrices,
      };
      accounts = await this.#getAllCreditAccounts(queue, blockNumber);
      if (accounts.length === 0 && this.config.liquidationMode === "full") {
        accounts = await this.#getExpiredCreditAccounts(blockNumber);
      }
    }
    if (this.config.ignoreAccounts) {
      const before = accounts.length;
      const ignoreAccounts = new AddressSet(this.config.ignoreAccounts);
      accounts = accounts.filter(ca => !ignoreAccounts.has(ca.creditAccount));
      this.log.debug(
        `filtered out ${before - accounts.length} ignored accounts`,
      );
    }

    if (this.config.liquidationMode === "deleverage") {
      accounts = await this.deleverage.filterDeleverageAccounts(
        accounts,
        blockNumber,
      );
    }

    const time = Math.round((Date.now() - start) / 1000);
    const verb =
      this.config.liquidationMode === "deleverage" ? "deleverage" : "liquidate";
    this.log.debug(
      `${accounts.length} accounts to ${verb}${blockS}, time: ${time}s`,
    );
    this.#liquidatableAccounts = accounts.length;

    if (this.config.optimistic) {
      await this.liquidatorService.liquidateOptimistic(accounts);
    } else {
      await this.liquidatorService.liquidate(accounts);
    }
  }

  async #getAllCreditAccounts(
    queue: GetCreditAccountsOptions,
    blockNumber?: bigint,
  ): Promise<CreditAccountData[]> {
    let accounts = await this.caService.getCreditAccounts(queue, blockNumber);
    let zeroHFAccs = accounts.filter(ca => ca.healthFactor === 0n);

    if (zeroHFAccs.length > 0) {
      this.log.warn(
        `found ${zeroHFAccs.length} accounts with HF=0 on first attempt, retrying`,
      );
      if (this.config.optimistic) {
        return accounts;
      }
      accounts = await this.caService.getCreditAccounts(queue, blockNumber);
      zeroHFAccs = accounts.filter(ca => ca.healthFactor === 0n);

      if (zeroHFAccs.length > 0) {
        accounts = accounts.filter(ca => ca.healthFactor !== 0n);
        const ignored = new AddressSet(this.config.ignoreAccounts);
        zeroHFAccs = zeroHFAccs.filter(ca => !ignored.has(ca.creditAccount));
      }

      if (zeroHFAccs.length > 0) {
        this.notifier.alert(
          new ZeroHFAccountsNotification(this.sdk, zeroHFAccs, blockNumber),
        );
      }
    }

    return accounts;
  }

  async #getExpiredCreditAccounts(
    blockNumber?: bigint,
  ): Promise<CreditAccountData[]> {
    this.log.debug(
      { timestamp: this.sdk.timestamp },
      "getting expired credit accounts",
    );
    const expiredCMs = new AddressSet();
    const expiredCmNames: string[] = [];

    for (const m of this.sdk.marketRegister.markets) {
      // nothing borrowed === no accounts
      if (m.pool.pool.totalBorrowed === 0n) {
        continue;
      }
      for (const cm of m.creditManagers) {
        const borrowed =
          m.pool.pool.creditManagerDebtParams.get(cm.creditManager.address)
            ?.borrowed ?? 0n;

        if (cm.isExpired && borrowed > 0n) {
          expiredCMs.add(cm.creditManager.address);
          expiredCmNames.push(`${m.pool.pool.name} - ${cm.creditManager.name}`);
        }
      }
    }

    if (expiredCMs.size === 0) {
      this.log.debug("no expired credit managers found");
      return [];
    }

    this.log.debug(
      `found ${expiredCMs.size} expired credit managers: ${expiredCmNames.join(", ")}`,
    );

    let result: CreditAccountData[] = [];
    if (this.config.optimistic) {
      result = await this.caService.getCreditAccounts(
        {
          ignoreReservePrices: true,
          minHealthFactor: 0n,
          maxHealthFactor: MAX_UINT256,
        },
        blockNumber,
      );
      result = result.filter(ca => expiredCMs.has(ca.creditManager));
    } else {
      const ignoreAccounts = new AddressSet(this.config.ignoreAccounts);
      for (const creditManager of expiredCMs) {
        // we can take first expired credit manager that has non-ignored accounts, and continue with next one on next block
        result = await this.caService.getCreditAccounts(
          {
            creditManager,
            ignoreReservePrices: true,
            minHealthFactor: 0n,
            maxHealthFactor: MAX_UINT256,
          },
          blockNumber,
        );
        result = result.filter(ca => !ignoreAccounts.has(ca.creditAccount));
        if (result.length > 0) {
          break;
        }
      }
    }

    this.log.debug(`found ${result.length} expired credit accounts`);
    return result;
  }

  public get lastUpdated(): bigint {
    return this.#lastUpdated;
  }

  public get liquidatableAccounts(): number {
    return this.#liquidatableAccounts;
  }

  public get minHealthFactor(): bigint {
    return this.#minHealthFactor;
  }

  public get maxHealthFactor(): bigint {
    return this.#maxHealthFactor;
  }

  public get sdk(): OnchainSDK {
    return this.caService.sdk;
  }

  public async stop(): Promise<void> {
    this.#unwatch?.();
    this.log.info("stopped");
  }
}
