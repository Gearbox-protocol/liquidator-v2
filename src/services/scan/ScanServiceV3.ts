import type { IDataCompressorV3 } from "@gearbox-protocol/sdk";
import {
  CreditAccountData,
  creditManagerByNetwork,
  ICreditManagerV3__factory,
  IDataCompressorV3__factory,
  PERCENTAGE_FACTOR,
  tokenDataByNetwork,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk";
import type { CreditAccountDataStructOutput } from "@gearbox-protocol/sdk/lib/types/IDataCompressorV3";
import type { providers } from "ethers";
import { Inject, Service } from "typedi";

import config from "../../config";
import { Logger, LoggerInterface } from "../../log";
import type { ILiquidatorService, PriceOnDemand } from "../liquidate";
import { LiquidatorServiceV3 } from "../liquidate";
import OracleServiceV3 from "../OracleServiceV3";
import { RedstoneServiceV3 } from "../RedstoneServiceV3";
import AbstractScanService from "./AbstractScanService";

@Service()
export class ScanServiceV3 extends AbstractScanService {
  @Logger("ScanServiceV3")
  log: LoggerInterface;

  @Inject()
  liquidarorServiceV3: LiquidatorServiceV3;

  @Inject()
  oracle: OracleServiceV3;

  @Inject()
  redstone: RedstoneServiceV3;

  protected dataCompressor: IDataCompressorV3;

  #restakingCMAddr?: string;
  #restakingMinHF?: number;

  protected override get liquidatorService(): ILiquidatorService {
    return this.liquidarorServiceV3;
  }

  protected override async _launch(
    provider: providers.Provider,
  ): Promise<void> {
    if (config.restakingWorkaround) {
      await this.#setupRestakingWorkaround();
    }
    const dcAddr = await this.addressProvider.findService(
      "DATA_COMPRESSOR",
      300,
    );
    this.dataCompressor = IDataCompressorV3__factory.connect(dcAddr, provider);

    const block = await provider.getBlockNumber();
    await this.oracle.launch(provider, block);
    // we should not pin block during optimistic liquidations
    // because during optimistic liquidations we need to call evm_mine to make redstone work
    await this.updateAccounts(
      config.optimisticLiquidations ? undefined : block,
    );
  }

  protected override async onBlock(blockNumber: number): Promise<void> {
    await this.oracle.update(blockNumber);
    await this.updateAccounts(blockNumber);
  }

  /**
   * Loads new data and recompute all health factors
   * @param atBlock Fiex block for archive node which is needed to get data
   */
  protected async updateAccounts(atBlock?: number): Promise<void> {
    const blockS = atBlock ? ` in ${atBlock}` : "";
    let [accounts, failedTokens] = await this.#potentialLiquidations(
      [],
      atBlock,
    );
    this.log.debug(
      `${accounts.length} v3 potential accounts to liquidate${blockS}: ${accounts.map(a => a.addr).join(",")}, failed tokens: ${failedTokens.length}`,
    );
    const redstoneUpdates = await this.redstone.updatesForTokens(failedTokens);
    [accounts, failedTokens] = await this.#potentialLiquidations(
      redstoneUpdates,
      atBlock,
    );
    accounts = accounts.sort((a, b) => a.healthFactor - b.healthFactor);
    if (config.restakingWorkaround) {
      accounts = this.#filterRestakingAccounts(accounts);
    }
    this.log.debug(
      `${accounts.length} v3 accounts to liquidate${blockS}: ${accounts.map(a => `${a.addr} [${a.healthFactor}]`).join(",")}`,
    );
    const redstoneTokens = redstoneUpdates.map(({ token }) => token);
    const redstoneSymbols = redstoneTokens.map(
      t => tokenSymbolByAddress[t.toLowerCase()],
    );
    this.log.debug(
      `got ${
        redstoneSymbols.length
      } redstone price updates: ${redstoneSymbols.join(", ")}`,
    );
    // TODO: what to do when non-redstone price fails?
    if (failedTokens.length > 0) {
      this.log.error(
        `failed tokens on second iteration: ${printTokens(failedTokens)}`,
      );
    }

    if (config.optimisticLiquidations) {
      await this.liquidateOptimistically(accounts);
    } else {
      await this.liquidateNormal(accounts);
    }
  }

  /**
   * Finds all potentially liquidatable credit accounts
   *
   * Returns
   * @param atBlock
   * @returns
   */
  async #potentialLiquidations(
    priceUpdates: PriceOnDemand[],
    atBlock?: number | undefined,
  ): Promise<[accounts: CreditAccountData[], failedTokens: string[]]> {
    let accountsRaw: CreditAccountDataStructOutput[] = [];

    let debugAccounts = config.debugAccounts ?? [];
    if (config.debugManagers && !debugAccounts.length) {
      for (const m of config.debugManagers) {
        this.log.debug(`will fetch debug credit accounts for ${m}`);
        const cm = ICreditManagerV3__factory.connect(m, this.provider);
        const accs = await cm["creditAccounts()"]({ blockTag: atBlock });
        this.log.debug(`fetched ${accs.length} debug credit accounts for ${m}`);
        debugAccounts.push(...accs);
      }
    }

    if (
      (config.debugManagers || config.debugAccounts) &&
      debugAccounts.length
    ) {
      this.log.debug(
        `will fetch data for ${debugAccounts.length} debug credit accounts`,
      );
      for (const acc of debugAccounts) {
        const accData =
          await this.dataCompressor.callStatic.getCreditAccountData(
            acc,
            priceUpdates,
            { blockTag: atBlock },
          );
        const cm = ICreditManagerV3__factory.connect(
          accData.creditManager,
          this.provider,
        );
        const isLiquidatable = await cm.isLiquidatable(acc, PERCENTAGE_FACTOR, {
          blockTag: atBlock,
        });
        if (isLiquidatable) {
          accountsRaw.push(accData);
        } else {
          this.log.warn(
            `debug account ${acc} is not liquidatable at block ${atBlock}`,
          );
        }
      }
      this.log.debug(
        `${accountsRaw.length}/${debugAccounts.length} debug accounts liquidatable`,
      );
    } else {
      accountsRaw =
        await this.dataCompressor.callStatic.getLiquidatableCreditAccounts(
          priceUpdates,
          atBlock
            ? {
                blockTag: atBlock,
              }
            : {},
        );
    }
    let accounts = accountsRaw.map(a => new CreditAccountData(a));

    // in optimistic mode, we can limit liquidations to all CM with provided underlying symbol
    if (config.underlying) {
      this.log.debug(`filtering accounts by underlying: ${config.underlying}`);
      accounts = accounts.filter(a => {
        const underlying = tokenSymbolByAddress[a.underlyingToken];
        return config.underlying?.toLowerCase() === underlying?.toLowerCase();
      });
    }

    const failedTokens = new Set<string>();
    for (const acc of accounts) {
      acc.priceFeedsNeeded.forEach(t => failedTokens.add(t));
    }

    return [accounts, Array.from(failedTokens)];
  }

  async #setupRestakingWorkaround(): Promise<void> {
    if (this.addressProvider.network === "Mainnet") {
      this.#restakingCMAddr =
        creditManagerByNetwork.Mainnet.WETH_V3_RESTAKING.toLowerCase();
    } else if (this.addressProvider.network === "Arbitrum") {
      this.#restakingCMAddr =
        creditManagerByNetwork.Arbitrum.WETH_V3_TRADE_TIER_1.toLowerCase();
    }

    if (this.#restakingCMAddr) {
      const cm = ICreditManagerV3__factory.connect(
        this.#restakingCMAddr,
        this.provider,
      );
      const [{ liquidationDiscount }, ezETHLT] = await Promise.all([
        cm.fees(),
        cm.liquidationThresholds(
          tokenDataByNetwork[this.addressProvider.network].ezETH,
        ),
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
      this.#restakingMinHF = Math.ceil(
        (100_00 * ezETHLT) / liquidationDiscount,
      );
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
            `filtered out ${ca.addr} due to restaking workaround (HF ${ca.healthFactor} < ${this.#restakingMinHF})`,
          );
        }
        return ok;
      }
      return true;
    });
  }
}

function printTokens(tokens: string[]): string {
  return tokens.map(t => tokenSymbolByAddress[t.toLowerCase()] ?? t).join(", ");
}
