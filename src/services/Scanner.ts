import type {
  CreditAccountData,
  GetCreditAccountsOptions,
  ICreditAccountsService,
  NetworkType,
} from "@gearbox-protocol/sdk";
import {
  AddressSet,
  hexEq,
  MAX_UINT256,
  PERCENTAGE_FACTOR,
  WAD,
} from "@gearbox-protocol/sdk";
import { iCreditManagerV300Abi } from "@gearbox-protocol/sdk/abi/v300";
import type { Address, Block } from "viem";
import { getContract } from "viem";
import type { Config } from "../config/index.js";
import { DI } from "../di.js";
import { type ILogger, Logger } from "../log/index.js";
import type Client from "./Client.js";
import type DeleverageService from "./DeleverageService.js";
import type { ILiquidatorService } from "./liquidate/index.js";
import { type INotifier, ZeroHFAccountsMessage } from "./notifier/index.js";

const RESTAKING_CMS: Partial<Record<NetworkType, Address>> = {
  Mainnet:
    "0x50ba483272484fc5eebe8676dc87d814a11faef6".toLowerCase() as Address, // Mainnet WETH_V3_RESTAKING
  Arbitrum:
    "0xcedaa4b4a42c0a771f6c24a3745c3ca3ed73f17a".toLowerCase() as Address, // Arbitrum WETH_V3_TRADE_TIER_1
};

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
  notifier!: INotifier;

  #processing: bigint | null = null;
  #restakingCMAddr?: Address;
  #restakingMinHF?: bigint;
  #lastUpdated = 0n;
  #maxHealthFactor = MAX_UINT256;
  #minHealthFactor = 0n;
  #unwatch?: () => void;
  #lastZeroHFNotification = 0;
  #liquidatableAccounts = 0;

  public async launch(): Promise<void> {
    await this.liquidatorService.launch();
    if (this.config.restakingWorkaround) {
      await this.#setupRestakingWorkaround();
    }

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
      this.#unwatch = this.client.pub.watchBlocks({
        onBlock: b => this.#onBlock(b),
        includeTransactions: false,
      });
    }
  }

  async #onBlock(block: Block<bigint, false, "latest">): Promise<void> {
    const { number: blockNumber, timestamp } = block;
    if (this.#processing) {
      this.log.debug(
        `skipping block ${blockNumber}, still processing block ${this.#processing}`,
      );
      return;
    }
    try {
      this.#processing = blockNumber;
      await this.caService.sdk.syncState({
        blockNumber,
        timestamp,
        // this effectively updates chainlink prices
        // we don't need this
        // if there're new price feeds, syncState will pick them up anyway
        // and redstone price updates will be updated in credit account service calls
        ignoreUpdateablePrices: true,
      });
      await this.liquidatorService.syncState(blockNumber);
      await this.#updateAccounts(blockNumber);
      this.#lastUpdated = blockNumber;
    } catch (e) {
      this.log.error(
        new Error(`failed to process block ${blockNumber}`, { cause: e }),
      );
      // this.#lastUpdated will not change in case of failed block
      // if this happens for multiple blocks, this error should be caught by metrics monitor, since lastUpdated metric will be stagnant
    } finally {
      this.#processing = null;
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
      if (accounts.length === 0) {
        accounts = await this.#getExpiredCreditAccounts(blockNumber);
      }
    }
    if (this.config.restakingWorkaround) {
      const before = accounts.length;
      accounts = this.#filterRestakingAccounts(accounts);
      this.log.debug(
        `filtered out ${before - accounts.length} restaking accounts`,
      );
    }
    if (this.config.lskEthWorkaround) {
      const before = accounts.length;
      accounts = await this.#filterLskETH(accounts);
      this.log.debug(
        `filtered out ${before - accounts.length} lskETH accounts`,
      );
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

        const badTokens = new AddressSet();
        for (const ca of zeroHFAccs) {
          for (const token of ca.tokens) {
            if (!token.success) {
              badTokens.add(token.token);
            }
          }
        }
        this.log.warn(
          `found ${zeroHFAccs.length} accounts with HF=0 and ${badTokens.size} bad tokens on second attempt skipping them`,
        );
        const badTokensStr = badTokens
          .asArray()
          .map(t => this.caService.sdk.tokensMeta.get(t)?.symbol ?? t)
          .join(", ");
        this.log.warn(`bad tokens: ${badTokensStr}`);
        this.#notifyOnZeroHFAccounts(zeroHFAccs.length, badTokensStr);
      }
    }

    return accounts;
  }

  async #getExpiredCreditAccounts(
    blockNumber?: bigint,
  ): Promise<CreditAccountData[]> {
    const expiredCMs = new AddressSet();
    const expiredCmNames: string[] = [];

    for (const m of this.caService.sdk.marketRegister.markets) {
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
      return [];
    }

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
      // we can take first expired credit manager, and continue with next one on next block
      result = await this.caService.getCreditAccounts(
        {
          creditManager: expiredCMs.asArray()[0],
          ignoreReservePrices: true,
          minHealthFactor: 0n,
          maxHealthFactor: MAX_UINT256,
        },
        blockNumber,
      );
    }

    this.log.debug(`found ${result.length} expired credit accounts`);
    return result;
  }

  async #setupRestakingWorkaround(): Promise<void> {
    this.#restakingCMAddr = RESTAKING_CMS[this.config.network];

    if (this.#restakingCMAddr) {
      const ezETH = this.caService.sdk.tokensMeta.mustFindBySymbol("ezETH");
      const cm = getContract({
        abi: iCreditManagerV300Abi,
        address: this.#restakingCMAddr,
        client: this.client.pub,
      });
      const [[, , liquidationDiscount], ezETHLT] = await Promise.all([
        cm.read.fees(),
        cm.read.liquidationThresholds([ezETH.addr]),
      ]);

      // For restaking accounts, say for simplicity account with only ezETH:
      //
      //        price(ezETH) * balance(ezETH) * LT(ezETH)
      // HF = ----------------------------------------------
      //                     debt(WETH)
      //
      // Assuming that price(ezETH) at some point becomes 1 (when you can withdraw ezETH):
      //
      //               balance(ezETH) * LT(ezETH)
      // debt(WETH) = ----------------------------
      //                        HF
      //
      // Amount that goes to gearbox + to account owner (if any) when account is liquidated:
      // liquidationDiscount == 100% - liquidatorPremium
      //
      // discounted = balance(ezETH) * LiquidationDiscount
      //
      // To avoid bad debt (discounted >= debt):
      //
      //                                           balance(ezETH) * LT(ezETH)
      // balance(ezETH) * LiquidationDiscount >=  ---------------------------
      //                                                        HF
      //          LT(ezETH)
      // HF >= --------------------
      //       LiquidationDiscount
      //
      // So it's safe to liquidate accounts with such HF, otherwise we get into bad debt zone
      // For current settings of  Restaking WETH credit manager on mainnet it translates to HF >= 91.50% / 0.97 == 94.33%
      this.#restakingMinHF =
        (PERCENTAGE_FACTOR * BigInt(ezETHLT)) / BigInt(liquidationDiscount);
      this.log.warn(
        {
          restakingCMAddr: this.#restakingCMAddr,
          liquidationDiscount,
          ezETHLT,
          restakingMinHF: this.#restakingMinHF,
        },
        "restaking workaround enabled",
      );
    }
  }

  #filterRestakingAccounts(accounts: CreditAccountData[]): CreditAccountData[] {
    return accounts.filter(ca => {
      if (
        this.#restakingCMAddr === ca.creditManager.toLowerCase() &&
        !!this.#restakingMinHF
      ) {
        const ok = ca.healthFactor >= this.#restakingMinHF;
        if (!ok) {
          this.log.debug(
            `filtered out ${ca.creditAccount} due to restaking workaround (HF ${ca.healthFactor} < ${this.#restakingMinHF})`,
          );
        }
        return ok;
      }
      return true;
    });
  }

  async #filterLskETH(
    accounts: CreditAccountData[],
  ): Promise<CreditAccountData[]> {
    if (this.config.network !== "Lisk" || this.config.optimistic) {
      return accounts;
    }
    // 0x1b10E2270780858923cdBbC9B5423e29fffD1A44 [lskETH]
    return accounts.filter(
      ca =>
        !ca.tokens.some(t =>
          hexEq(t.token, "0x1b10E2270780858923cdBbC9B5423e29fffD1A44"),
        ),
    );
  }

  #notifyOnZeroHFAccounts(count: number, badTokens: string): void {
    const now = Date.now();
    if (now - this.#lastZeroHFNotification < 1000 * 60 * 5) {
      return;
    }
    this.#lastZeroHFNotification = now;
    this.log.debug("notifying on zero HF accounts");
    this.notifier.alert(new ZeroHFAccountsMessage(count, badTokens));
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

  public async stop(): Promise<void> {
    this.#unwatch?.();
    this.log.info("stopped");
  }
}
