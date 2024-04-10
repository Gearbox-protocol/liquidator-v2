import type { CreditAccountData } from "@gearbox-protocol/sdk";
import { ICreditFacadeV2__factory, PathFinderV1 } from "@gearbox-protocol/sdk";
import type { PathFinderV1CloseResult } from "@gearbox-protocol/sdk/lib/pathfinder/v1/core";
import type { BigNumberish, ContractReceipt } from "ethers";
import { Inject, Service } from "typedi";

import { CONFIG, ConfigSchema } from "../../config";
import { Logger, LoggerInterface } from "../../log";
import { AddressProviderService } from "../AddressProviderService";
import { AMPQService } from "../ampqService";
import ExecutorService from "../ExecutorService";
import type { ILiquidationStrategy } from "./types";

@Service()
export default class LiquidationStrategyV2
  implements ILiquidationStrategy<PathFinderV1CloseResult>
{
  public readonly name = "full";
  public readonly adverb = "fully";

  @Logger("LiquidationStrategyV2")
  logger: LoggerInterface;

  @Inject(CONFIG)
  config: ConfigSchema;

  @Inject()
  ampqService: AMPQService;

  @Inject()
  addressProvider: AddressProviderService;

  @Inject()
  executor: ExecutorService;

  #pathFinder?: PathFinderV1;

  public async launch(): Promise<void> {
    const pathFinder = await this.addressProvider.findService("ROUTER", 1);
    this.#pathFinder = new PathFinderV1(
      pathFinder,
      this.executor.provider,
      this.addressProvider.network,
      PathFinderV1.connectors,
    );
  }

  public async preview(
    ca: CreditAccountData,
  ): Promise<PathFinderV1CloseResult> {
    try {
      const result = await this.pathFinder.findBestClosePath(
        ca,
        this.config.slippage,
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
    account: CreditAccountData,
    preview: PathFinderV1CloseResult,
  ): Promise<BigNumberish> {
    const iFacade = ICreditFacadeV2__factory.connect(
      account.creditFacade,
      this.executor.wallet,
    );
    return iFacade.estimateGas[
      "liquidateCreditAccount(address,address,uint256,bool,(address,bytes)[])"
    ](account.borrower, this.executor.address, 0, true, preview.calls);
  }

  public async liquidate(
    account: CreditAccountData,
    preview: PathFinderV1CloseResult,
    gasLimit?: BigNumberish,
  ): Promise<ContractReceipt> {
    const facade = ICreditFacadeV2__factory.connect(
      account.creditFacade,
      this.executor.wallet,
    );

    const txData = await facade.populateTransaction[
      "liquidateCreditAccount(address,address,uint256,bool,(address,bytes)[])"
    ](
      account.borrower,
      this.executor.address,
      0,
      true,
      preview.calls,
      gasLimit ? { gasLimit } : {},
    );

    return this.executor.sendPrivate(txData);
  }

  private get pathFinder(): PathFinderV1 {
    if (!this.#pathFinder) {
      throw new Error(`not launched`);
    }
    return this.#pathFinder;
  }
}
