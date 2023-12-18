import type {
  Asset,
  CreditAccountData,
  IDataCompressorV3_00,
  MultiCall,
} from "@gearbox-protocol/sdk";
import {
  CreditManagerData,
  IAddressProviderV3__factory,
  ICreditFacadeV3__factory,
  IDataCompressorV3_00__factory,
  PathFinder,
} from "@gearbox-protocol/sdk";
import type { PathFinderV1CloseResult } from "@gearbox-protocol/sdk/lib/pathfinder/v1/core";
import type { providers } from "ethers";
import { ethers } from "ethers";
import { Service } from "typedi";

import config from "../../config";
import { Logger, LoggerInterface } from "../../log";
import AbstractLiquidatorService from "./AbstractLiquidatorService";
import type { ILiquidatorService } from "./types";

@Service()
export class LiquidatorServiceV3
  extends AbstractLiquidatorService
  implements ILiquidatorService
{
  #pathFinder: PathFinder;
  #compressor: IDataCompressorV3_00;

  @Logger("LiquidatorServiceV3")
  log: LoggerInterface;

  /**
   * Launch LiquidatorService
   */
  public async launch(provider: providers.Provider): Promise<void> {
    await super.launch(provider);
    const addressProvider = IAddressProviderV3__factory.connect(
      config.addressProvider,
      this.provider,
    );
    let [pfAddr, dcAddr] = await Promise.allSettled([
      addressProvider.getAddressOrRevert(
        ethers.utils.formatBytes32String("ROUTER"),
        300,
      ),
      addressProvider.getAddressOrRevert(
        ethers.utils.formatBytes32String("DATA_COMPRESSOR"),
        300,
      ),
    ]);
    if (dcAddr.status === "rejected") {
      throw new Error(`cannot get DC_300: ${dcAddr.reason}`);
    }
    this.log.debug(
      `Router: ${(pfAddr as any)?.value}, compressor: ${dcAddr.value}`,
    );
    this.#compressor = IDataCompressorV3_00__factory.connect(
      dcAddr.value,
      this.provider,
    );
    this.#pathFinder = new PathFinder(
      pfAddr.status === "fulfilled"
        ? pfAddr.value
        : "0xC46613db74c8B734D8074E7D02239139cB35Ed66",
      this.provider,
      this.network,
      PathFinder.connectors,
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
    this.log.debug(`liquidating ${account.addr} in ${account.creditManager}`);
    const tx = await facade.liquidateCreditAccount(
      account.addr,
      this.keyService.address,
      calls,
      optimistic ? { gasLimit: 29e6 } : undefined,
    );
    return tx;
  }

  protected async findClosePath(
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
      return result;
    } catch (e) {
      throw new Error(`cant find close path: ${e}`);
    }
  }

  protected override async _estimate(
    account: CreditAccountData,
    calls: MultiCall[],
  ): Promise<void> {
    const facade = ICreditFacadeV3__factory.connect(
      account.creditFacade,
      this.keyService.signer,
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
