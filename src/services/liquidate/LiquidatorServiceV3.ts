import type { CreditAccountData, MultiCall } from "@gearbox-protocol/sdk";
import {
  IAddressProviderV3__factory,
  ICreditFacadeV3__factory,
  PathFinder,
} from "@gearbox-protocol/sdk";
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
    const pathFinder = await addressProvider.getAddressOrRevert(
      ethers.utils.formatBytes32String("ROUTER"),
      300,
    );
    this.log.debug(`Router: ${pathFinder}`);

    this.pathFinder = new PathFinder(pathFinder, this.provider, this.network, [
      "WETH",
      "DAI",
      "USDC",
    ]);
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
    const tx = await facade.liquidateCreditAccount(
      account.addr,
      this.keyService.address,
      0,
      true,
      calls,
      optimistic ? { gasLimit: 29e6 } : undefined,
    );
    return tx;
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
      account.borrower,
      this.keyService.address,
      0,
      true,
      calls,
    );
    this.log.debug(`estimated gas: ${estGas}`);
  }
}
