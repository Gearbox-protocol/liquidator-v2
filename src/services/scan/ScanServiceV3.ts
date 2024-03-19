import type { IDataCompressorV3 } from "@gearbox-protocol/sdk";
import {
  CreditAccountData,
  IDataCompressorV3__factory,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk";
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

  protected override get liquidatorService(): ILiquidatorService {
    return this.liquidarorServiceV3;
  }

  protected override async _launch(
    provider: providers.Provider,
  ): Promise<void> {
    const dcAddr = await this.addressProvider.findService(
      "DATA_COMPRESSOR",
      300,
    );
    this.dataCompressor = IDataCompressorV3__factory.connect(dcAddr, provider);

    const block = await provider.getBlockNumber();
    await this.oracle.launch(provider, block);
    // we should not pin block during optimistic liquidations
    // because during optimistic liquidations we need to call evm_mine to make redstone work
    await this.updateAccounts(config.optimistic ? undefined : block);
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
      `v3 potential accounts to liquidate${blockS}: ${accounts.length}, failed tokens: ${failedTokens.length}`,
    );
    const redstoneUpdates = await this.redstone.updatesForTokens(failedTokens);
    [accounts, failedTokens] = await this.#potentialLiquidations(
      redstoneUpdates,
      atBlock,
    );
    this.log.debug(`v3 accounts to liquidate${blockS}: ${accounts.length}`);
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

    if (config.optimistic) {
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
    const accountsRaw =
      await this.dataCompressor.callStatic.getLiquidatableCreditAccounts(
        priceUpdates,
        atBlock
          ? {
              blockTag: atBlock,
            }
          : {},
      );
    let accounts = accountsRaw.map(a => new CreditAccountData(a));

    // in optimistic mode, we can limit liquidations to all CM with provided underlying symbol
    if (config.underlying) {
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
}

function printTokens(tokens: string[]): string {
  return tokens.map(t => tokenSymbolByAddress[t.toLowerCase()] ?? t).join(", ");
}
