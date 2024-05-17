import { getDecimals } from "@gearbox-protocol/sdk-gov";
import type { Balance } from "@gearbox-protocol/types/v3";
import { ICreditFacadeV3__factory } from "@gearbox-protocol/types/v3";
import type { TransactionReceipt } from "ethers";
import { Service } from "typedi";

import { Logger, type LoggerInterface } from "../../log";
import type { CreditAccountData } from "../../utils/ethers-6-temp";
import type { PathFinderCloseResult } from "../../utils/ethers-6-temp/pathfinder";
import AbstractLiquidationStrategyV3 from "./AbstractLiquidationStrategyV3";
import type { ILiquidationStrategy, MakeLiquidatableResult } from "./types";

@Service()
export default class LiquidationStrategyV3Full
  extends AbstractLiquidationStrategyV3
  implements ILiquidationStrategy<PathFinderCloseResult>
{
  public readonly name = "full";
  public readonly adverb = "fully";

  @Logger("LiquidationStrategyV3Full")
  logger: LoggerInterface;

  public async makeLiquidatable(
    ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult> {
    // not supported
    return Promise.resolve({});
  }

  public async preview(ca: CreditAccountData): Promise<PathFinderCloseResult> {
    try {
      const cm = await this.getCreditManagerData(ca.creditManager);
      const expectedBalances: Record<string, Balance> = {};
      const leftoverBalances: Record<string, Balance> = {};
      Object.entries(ca.allBalances).forEach(
        ([token, { balance, isEnabled }]) => {
          expectedBalances[token] = { token, balance };
          // filter out dust, we don't want to swap it
          const minBalance = 10n ** BigInt(Math.max(8, getDecimals(token)) - 8);
          // also: gearbox liquidator does not need to swap disabled tokens. third-party liquidators might want to do it
          if (balance < minBalance || !isEnabled) {
            leftoverBalances[token] = { token, balance };
          }
        },
      );
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
      const priceUpdateCalls = await this.redstone.multicallUpdates(ca);
      return {
        amount: result.amount,
        minAmount: result.minAmount,
        underlyingBalance: result.underlyingBalance,
        calls: [...priceUpdateCalls, ...result.calls],
      };
    } catch (e) {
      throw new Error(`cant find close path: ${e}`);
    }
  }

  public async estimate(
    account: CreditAccountData,
    preview: PathFinderCloseResult,
  ): Promise<bigint> {
    const facade = ICreditFacadeV3__factory.connect(
      account.creditFacade,
      this.executor.wallet,
    );
    return facade.liquidateCreditAccount.estimateGas(
      account.addr,
      this.executor.address,
      preview.calls,
    );
  }

  public async liquidate(
    account: CreditAccountData,
    preview: PathFinderCloseResult,
    gasLimit?: bigint,
  ): Promise<TransactionReceipt> {
    const facade = ICreditFacadeV3__factory.connect(
      account.creditFacade,
      this.executor.wallet,
    );
    const txData = await facade.liquidateCreditAccount.populateTransaction(
      account.addr,
      this.executor.address,
      preview.calls,
      gasLimit ? { gasLimit } : {},
    );
    return this.executor.sendPrivate(txData);
  }
}
