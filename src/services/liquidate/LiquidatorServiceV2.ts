import type { CreditAccountData, MultiCall } from "@gearbox-protocol/sdk";
import { ICreditFacadeV2__factory, PathFinderV1 } from "@gearbox-protocol/sdk";
import type { PathFinderV1CloseResult } from "@gearbox-protocol/sdk/lib/pathfinder/v1/core";
import type { ethers, providers } from "ethers";
import { Service } from "typedi";

import { Logger, LoggerInterface } from "../../log";
import AbstractLiquidatorService from "./AbstractLiquidatorService";
import type { ILiquidatorService } from "./types";

@Service()
export class LiquidatorServiceV2
  extends AbstractLiquidatorService
  implements ILiquidatorService
{
  #pathFinder: PathFinderV1;

  @Logger("LiquidatorServiceV2")
  log: LoggerInterface;

  /**
   * Launch LiquidatorService
   */
  public async launch(provider: providers.Provider): Promise<void> {
    await super.launch(provider);
    const pathFinder = await this.addressProvider.findService("ROUTER", 1);
    this.log.debug(`Router: ${pathFinder}`);

    this.#pathFinder = new PathFinderV1(
      pathFinder,
      this.provider,
      this.addressProvider.network,
      PathFinderV1.connectors,
    );
  }

  protected async _findClosePath(
    ca: CreditAccountData,
  ): Promise<PathFinderV1CloseResult> {
    try {
      const result = await this.#pathFinder.findBestClosePath(
        ca,
        this.slippage,
        true,
      );
      if (!result) {
        throw new Error("result is empty");
      }
      return result;
    } catch (e) {
      throw new Error(`cant find close path: ${e}`);
    }
  }

  protected override async _liquidateFully(
    executor: ethers.Wallet,
    account: CreditAccountData,
    calls: MultiCall[],
    optimistic: boolean,
    recipient?: string,
  ): Promise<ethers.ContractTransaction> {
    const facade = ICreditFacadeV2__factory.connect(
      account.creditFacade,
      executor,
    );
    this.log.debug(
      `liquidating v2 ${account.addr} in ${account.creditManager}`,
    );
    const tx = await facade[
      "liquidateCreditAccount(address,address,uint256,bool,(address,bytes)[])"
    ](
      account.borrower,
      recipient ?? this.keyService.address,
      0,
      true,
      calls,
      optimistic ? { gasLimit: 29e6 } : {},
    );
    console.log(`tx hash: ${tx.hash}`);
    return tx;
  }

  protected override async _estimate(
    executor: ethers.Wallet,
    account: CreditAccountData,
    calls: MultiCall[],
    recipient?: string,
  ): Promise<void> {
    const iFacade = ICreditFacadeV2__factory.connect(
      account.creditFacade,
      executor,
    );
    // before actual transaction, try to estimate gas
    // this effectively will load state and contracts from fork origin to anvil
    // so following actual tx should not be slow
    // also tx will act as retry in case of anvil external's error
    const estGas = await iFacade.estimateGas[
      "liquidateCreditAccount(address,address,uint256,bool,(address,bytes)[])"
    ](account.borrower, recipient ?? this.keyService.address, 0, true, calls);
    this.log.debug(`estimated gas: ${estGas}`);
  }
}
