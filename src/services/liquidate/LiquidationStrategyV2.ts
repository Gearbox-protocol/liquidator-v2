import type { CreditAccountData } from "@gearbox-protocol/sdk";
import { ICreditFacadeV2__factory, PathFinderV1 } from "@gearbox-protocol/sdk";
import type { PathFinderV1CloseResult } from "@gearbox-protocol/sdk/lib/pathfinder/v1/core";
import type {
  BigNumberish,
  ContractTransaction,
  providers,
  Wallet,
} from "ethers";
import { Inject, Service } from "typedi";

import { Logger, LoggerInterface } from "../../log";
import { AddressProviderService } from "../AddressProviderService";
import { AMPQService } from "../ampqService";
import type { ILiquidationStrategy } from "./types";

@Service()
export default class LiquidationStrategyV2
  implements ILiquidationStrategy<PathFinderV1CloseResult>
{
  public readonly name = "full";
  public readonly adverb = "fully";

  @Logger("LiquidationStrategyV2")
  logger: LoggerInterface;

  @Inject()
  ampqService: AMPQService;

  @Inject()
  addressProvider: AddressProviderService;

  #pathFinder?: PathFinderV1;

  public async launch(provider: providers.Provider): Promise<void> {
    const pathFinder = await this.addressProvider.findService("ROUTER", 1);
    this.#pathFinder = new PathFinderV1(
      pathFinder,
      provider,
      this.addressProvider.network,
      PathFinderV1.connectors,
    );
  }

  public async preview(
    ca: CreditAccountData,
    slippage: number,
  ): Promise<PathFinderV1CloseResult> {
    try {
      const result = await this.pathFinder.findBestClosePath(
        ca,
        slippage,
        true,
        this.addressProvider.network,
      );
      if (!result) {
        throw new Error("result is empty");
      }
      return result;
    } catch (e) {
      throw new Error(`cant find close path: ${e}`);
    }
  }

  public async estimate(
    executor: Wallet,
    account: CreditAccountData,
    preview: PathFinderV1CloseResult,
    recipient: string,
  ): Promise<BigNumberish> {
    const iFacade = ICreditFacadeV2__factory.connect(
      account.creditFacade,
      executor,
    );
    return iFacade.estimateGas[
      "liquidateCreditAccount(address,address,uint256,bool,(address,bytes)[])"
    ](account.borrower, recipient, 0, true, preview.calls);
  }

  public async liquidate(
    executor: Wallet,
    account: CreditAccountData,
    preview: PathFinderV1CloseResult,
    recipient: string,
    gasLimit?: BigNumberish,
  ): Promise<ContractTransaction> {
    const facade = ICreditFacadeV2__factory.connect(
      account.creditFacade,
      executor,
    );
    return facade[
      "liquidateCreditAccount(address,address,uint256,bool,(address,bytes)[])"
    ](
      account.borrower,
      recipient,
      0,
      true,
      preview.calls,
      gasLimit ? { gasLimit } : {},
    );
  }

  private get pathFinder(): PathFinderV1 {
    if (!this.#pathFinder) {
      throw new Error(`not launched`);
    }
    return this.#pathFinder;
  }
}
