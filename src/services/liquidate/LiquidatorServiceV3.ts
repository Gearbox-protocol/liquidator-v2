import type {
  Asset,
  CreditAccountData,
  IDataCompressorV3,
  MultiCall,
} from "@gearbox-protocol/sdk";
import {
  CreditManagerData,
  ICreditFacadeV3__factory,
  IDataCompressorV3__factory,
  PathFinder,
} from "@gearbox-protocol/sdk";
import type { PathFinderV1CloseResult } from "@gearbox-protocol/sdk/lib/pathfinder/v1/core";
import type { ethers, providers } from "ethers";
import { Inject, Service } from "typedi";

import { Logger, LoggerInterface } from "../../log";
import { RedstoneServiceV3 } from "../RedstoneServiceV3";
import AbstractLiquidatorService from "./AbstractLiquidatorService";
import type { ILiquidatorService } from "./types";

@Service()
export class LiquidatorServiceV3
  extends AbstractLiquidatorService
  implements ILiquidatorService
{
  #pathFinder: PathFinder;
  #compressor: IDataCompressorV3;

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
  }

  protected override async _liquidate(
    executor: ethers.Wallet,
    account: CreditAccountData,
    calls: MultiCall[],
    optimistic: boolean,
  ): Promise<ethers.ContractTransaction> {
    const facade = ICreditFacadeV3__factory.connect(
      account.creditFacade,
      executor,
    );
    this.log.debug(
      `liquidating v3 ${account.addr} in ${account.creditManager}`,
    );
    const tx = await facade.liquidateCreditAccount(
      account.addr,
      this.keyService.address,
      calls,
      optimistic ? { gasLimit: 29e6 } : {},
    );
    this.log.debug(`tx hash: ${tx.hash}`);
    return tx;
  }

  protected async _findClosePath(
    ca: CreditAccountData,
  ): Promise<PathFinderV1CloseResult> {
    try {
      const cm = await this.#compressor.getCreditManagerData(ca.creditManager);
      const expectedBalances: Record<string, Asset> = {};
      Object.entries(ca.balances).forEach(([token, balance]) => {
        expectedBalances[token] = { token, balance };
      });
      const result = await this.#pathFinder.findBestClosePath({
        creditAccount: ca,
        creditManager: new CreditManagerData(cm),
        expectedBalances,
        leftoverBalances: {},
        slippage: this.slippage,
        noConcurrency: true,
      });
      if (!result) {
        throw new Error("result is empty");
      }
      // we want fresh redstone price in actual liquidation transactions
      const priceUpdateCalls = await this.redstone.updatesForAccount(ca);
      result.calls = [...priceUpdateCalls, ...result.calls];
      return result;
    } catch (e) {
      throw new Error(`cant find close path: ${e}`);
    }
  }

  protected override async _estimate(
    executor: ethers.Wallet,
    account: CreditAccountData,
    calls: MultiCall[],
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
      this.keyService.address,
      calls,
    );
    this.log.debug(`estimated gas: ${estGas}`);
  }
}
