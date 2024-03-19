import type {
  Asset,
  CreditAccountData,
  IDataCompressorV3,
  MultiCall,
} from "@gearbox-protocol/sdk";
import {
  ADDRESS_0X0,
  CreditManagerData,
  ICreditFacadeV3__factory,
  IDataCompressorV3__factory,
  PathFinder,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk";
import type { PathFinderV1CloseResult } from "@gearbox-protocol/sdk/lib/pathfinder/v1/core";
import type { ethers, providers } from "ethers";
import { Inject, Service } from "typedi";

import { Logger, LoggerInterface } from "../../log";
import { RedstoneServiceV3 } from "../RedstoneServiceV3";
import AbstractLiquidatorService from "./AbstractLiquidatorService";
import type { ILiquidator } from "./generated";
import { ILiquidator__factory } from "./generated";
import type { ILiquidatorService, PartialLiquidationPreview } from "./types";

@Service()
export class LiquidatorServiceV3
  extends AbstractLiquidatorService
  implements ILiquidatorService
{
  #pathFinder: PathFinder;
  #compressor: IDataCompressorV3;
  #partialLiquidator: ILiquidator;

  @Logger("LiquidatorServiceV3")
  log: LoggerInterface;

  @Inject()
  redstone: RedstoneServiceV3;

  /**
   * Launch LiquidatorService
   */
  public async launch(provider: providers.Provider): Promise<void> {
    await super.launch(provider);
    const [pfAddr, dcAddr] = await Promise.all([
      this.addressProvider.findService("ROUTER", 300),
      this.addressProvider.findService("DATA_COMPRESSOR", 300),
    ]);
    this.log.debug(`Router: ${pfAddr}, compressor: ${dcAddr}`);
    this.#compressor = IDataCompressorV3__factory.connect(
      dcAddr,
      this.provider,
    );
    this.#pathFinder = new PathFinder(
      pfAddr,
      this.provider,
      this.addressProvider.network,
    );
    // TODO: obtain address
    this.#partialLiquidator = ILiquidator__factory.connect(
      ADDRESS_0X0,
      this.provider,
    );
  }

  protected override async _liquidateFully(
    executor: ethers.Wallet,
    account: CreditAccountData,
    calls: MultiCall[],
    optimistic: boolean,
    recipient?: string,
  ): Promise<ethers.ContractTransaction> {
    const facade = ICreditFacadeV3__factory.connect(
      account.creditFacade,
      executor,
    );
    this.log.debug(`full liquidation of ${this.getAccountTitle(account)}`);
    const tx = await facade.liquidateCreditAccount(
      account.addr,
      recipient ?? this.keyService.address,
      calls,
      optimistic ? { gasLimit: 29e6 } : {},
    );
    this.log.debug(`full liqudationtx hash: ${tx.hash}`);
    return tx;
  }

  protected async _liquidatePartially(
    executor: ethers.Wallet,
    account: CreditAccountData,
    preview: PartialLiquidationPreview,
    optimistic: boolean,
    recipient?: string,
  ): Promise<ethers.ContractTransaction> {
    // TODO: executor, recipient
    this.log.debug(`partial liquidation of ${this.getAccountTitle(account)}`);
    const priceUpdates = await this.redstone.liquidationPreviewUpdates(account);
    const tx = await this.#partialLiquidator.partialLiquidateAndConvert(
      account.creditManager,
      account.addr,
      preview.assetOut,
      preview.amountOut,
      priceUpdates,
      preview.conversionCalls,
      optimistic ? { gasLimit: 29e6 } : {},
    );
    this.log.debug(`partial liqudationtx hash: ${tx.hash}`);
    return tx;
  }

  protected async _findClosePath(
    ca: CreditAccountData,
  ): Promise<PathFinderV1CloseResult> {
    try {
      const cm = new CreditManagerData(
        await this.#compressor.getCreditManagerData(ca.creditManager),
      );
      const expectedBalances: Record<string, Asset> = {};
      Object.entries(ca.balances).forEach(([token, balance]) => {
        expectedBalances[token] = { token, balance };
      });
      const result = await this.#pathFinder.findBestClosePath({
        creditAccount: ca,
        creditManager: cm,
        expectedBalances,
        leftoverBalances: {},
        slippage: this.slippage,
        noConcurrency: true,
      });
      if (!result) {
        throw new Error("result is empty");
      }
      // we want fresh redstone price in actual liquidation transactions
      const priceUpdateCalls = await this.redstone.compressorUpdates(ca);
      result.calls = [...priceUpdateCalls, ...result.calls];
      return result;
    } catch (e) {
      throw new Error(`cant find close path: ${e}`);
    }
  }

  protected async _previewPartialLiquidation(
    ca: CreditAccountData,
  ): Promise<PartialLiquidationPreview> {
    const name = this.getAccountTitle(ca);
    const cm = new CreditManagerData(
      await this.#compressor.getCreditManagerData(ca.creditManager),
    );
    // sort by liquidation threshold ASC and skip underlying
    // TODO: maybe should use 'balances' instead of 'allBalances': 'balances' does not contain forbidden tokens
    const balances = Object.entries(ca.allBalances)
      .filter(([t]) => t.toLowerCase() !== ca.underlyingToken.toLowerCase())
      .map(
        ([t, b]) =>
          [
            t,
            b.balance,
            cm.liquidationThresholds[t.toLowerCase()] ?? 0n,
          ] as const,
      )
      .sort((a, b) => Number(a[2]) - Number(b[2]));

    for (const [assetOut, balance] of balances) {
      const symb = tokenSymbolByAddress[assetOut.toLowerCase()];
      // naively try to figure out amount that works
      for (let i = 1n; i <= 10n; i++) {
        // Always get fresh prices, because in optimistic mode this loop is quite slow
        // TODO: maybe it should be debounced
        const priceUpdates = await this.redstone.liquidationPreviewUpdates(ca);
        const amountOut = (i * balance) / 10n;
        this.log.debug(
          `trying partial liqudation of ${name}: ${i * 10n}% of ${symb} out`,
        );
        const result =
          await this.#partialLiquidator.callStatic.previewPartialLiquidation(
            cm.address,
            ca.addr,
            assetOut,
            amountOut,
            priceUpdates,
            connectors,
            this.slippage,
          );
        if (result.calls.length) {
          this.log.info(
            `preview of partial liquidation of ${name}: ${i * 10n}% of ${symb} succeeded with profit ${result.profit.toString()}`,
          );
          return {
            amountOut,
            assetOut,
            conversionCalls: result.calls,
          };
        }
      }
    }

    throw new Error(
      `cannot find token and amount for successfull partial liquidation of ${name}`,
    );
  }

  protected override async _estimate(
    executor: ethers.Wallet,
    account: CreditAccountData,
    calls: MultiCall[],
    recipient?: string,
  ): Promise<void> {
    const facade = ICreditFacadeV3__factory.connect(
      account.creditFacade,
      executor,
    );
    // before actual transaction, try to estimate gas
    // this effectively will load state and contracts from fork origin to anvil
    // so following actual tx should not be slow
    // also tx will act as retry in case of anvil external's error
    const estGas = await facade.estimateGas.liquidateCreditAccount(
      account.addr,
      recipient ?? this.keyService.address,
      calls,
    );
    this.log.debug(`estimated gas: ${estGas}`);
  }
}
