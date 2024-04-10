import type { Asset, CreditAccountData } from "@gearbox-protocol/sdk";
import {
  CreditManagerData,
  getDecimals,
  ICreditFacadeV3__factory,
} from "@gearbox-protocol/sdk";
import type { PathFinderV1CloseResult } from "@gearbox-protocol/sdk/lib/pathfinder/v1/core";
import type { BigNumberish, ContractReceipt } from "ethers";
import { Service } from "typedi";

import { Logger, LoggerInterface } from "../../log";
import AbstractLiquidationStrategyV3 from "./AbstractLiquidationStrategyV3";
import type { ILiquidationStrategy } from "./types";

@Service()
export default class LiquidationStrategyV3Full
  extends AbstractLiquidationStrategyV3
  implements ILiquidationStrategy<PathFinderV1CloseResult>
{
  public readonly name = "full";
  public readonly adverb = "fully";

  @Logger("LiquidationStrategyV3Full")
  logger: LoggerInterface;

  public async preview(
    ca: CreditAccountData,
  ): Promise<PathFinderV1CloseResult> {
    try {
      const cm = new CreditManagerData(
        await this.compressor.getCreditManagerData(ca.creditManager),
      );
      const expectedBalances: Record<string, Asset> = {};
      const leftoverBalances: Record<string, Asset> = {};
      Object.entries(ca.balances).forEach(([token, balance]) => {
        expectedBalances[token] = { token, balance };
        // filter out dust, we don't want to swap it
        const minBalance = 10n ** BigInt(Math.max(8, getDecimals(token)) - 8);
        // also: gearbox liquidator does not need to swap disabled tokens. third-party liquidators might want to do it
        if (balance < minBalance || !ca.allBalances[token].isEnabled) {
          leftoverBalances[token] = { token, balance };
        }
      });
      const result = await this.pathFinder.findBestClosePath({
        creditAccount: ca,
        creditManager: cm,
        expectedBalances,
        leftoverBalances,
        slippage: this.config.slippage,
        noConcurrency: true,
        network: this.addressProvider.network,
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

  public async estimate(
    account: CreditAccountData,
    preview: PathFinderV1CloseResult,
  ): Promise<BigNumberish> {
    const facade = ICreditFacadeV3__factory.connect(
      account.creditFacade,
      this.executor.wallet,
    );
    return facade.estimateGas.liquidateCreditAccount(
      account.addr,
      this.executor.address,
      preview.calls,
    );
  }

  public async liquidate(
    account: CreditAccountData,
    preview: PathFinderV1CloseResult,
    recipient: string,
    gasLimit?: BigNumberish,
  ): Promise<ContractReceipt> {
    const facade = ICreditFacadeV3__factory.connect(
      account.creditFacade,
      this.executor.wallet,
    );
    const txData = await facade.populateTransaction.liquidateCreditAccount(
      account.addr,
      recipient,
      preview.calls,
      gasLimit ? { gasLimit } : {},
    );
    return this.executor.sendPrivate(txData);
  }
}
