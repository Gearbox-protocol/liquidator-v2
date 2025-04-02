import type {
  CreditAccountData,
  CreditAccountsService,
  NetworkType,
} from "@gearbox-protocol/sdk";
import { MAX_UINT16, PERCENTAGE_FACTOR } from "@gearbox-protocol/sdk";
import { iCreditManagerV3Abi } from "@gearbox-protocol/types/abi";
import type { Address, Block } from "viem";
import { getContract } from "viem";

import type { Config } from "../config/index.js";
import { DI } from "../di.js";
import { type ILogger, Logger } from "../log/index.js";
import type Client from "./Client.js";
import type { ILiquidatorService } from "./liquidate/index.js";

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
  caService!: CreditAccountsService;

  #processing: bigint | null = null;
  #restakingCMAddr?: Address;
  #restakingMinHF?: bigint;
  #lastUpdated = 0n;

  public async launch(): Promise<void> {
    await this.liquidatorService.launch();
    if (this.config.restakingWorkaround) {
      await this.#setupRestakingWorkaround();
    }

    const block = await this.client.pub.getBlock();
    // we should not pin block during optimistic liquidations
    // because during optimistic liquidations we need to call evm_mine to make redstone work
    await this.#updateAccounts(
      this.config.optimistic ? undefined : block.number,
    );
    if (!this.config.optimistic) {
      this.client.pub.watchBlocks({
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
        skipPriceUpdate: true,
      });
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
   * @param blockNumber Fiex block for archive node which is needed to get data
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
      let maxHealthFactor = Number(this.config.hfThreshold);
      if (this.config.optimistic && this.config.isPartial) {
        maxHealthFactor = Number(MAX_UINT16);
      }
      accounts = await this.caService.getCreditAccounts(
        {
          minHealthFactor: 0,
          maxHealthFactor,
          includeZeroDebt: false,
          creditManager: this.config.debugManager,
        },
        blockNumber,
      );
    }
    if (this.config.restakingWorkaround) {
      const before = accounts.length;
      accounts = this.#filterRestakingAccounts(accounts);
      this.log.debug(
        `filtered out ${before - accounts.length} restaking accounts`,
      );
    }
    const time = Math.round((new Date().getTime() - start) / 1000);
    this.log.debug(
      `${accounts.length} accounts to liquidate${blockS}, time: ${time}s`,
    );

    if (this.config.optimistic) {
      await this.liquidatorService.liquidateOptimistic(accounts);
    } else {
      await this.liquidatorService.liquidate(accounts);
    }
  }

  async #setupRestakingWorkaround(): Promise<void> {
    this.#restakingCMAddr = RESTAKING_CMS[this.config.network];
    const ezETH = this.caService.sdk.tokensMeta.mustFindBySymbol("ezETH");

    if (this.#restakingCMAddr) {
      const cm = getContract({
        abi: iCreditManagerV3Abi,
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

  public get lastUpdated(): bigint {
    return this.#lastUpdated;
  }
}
