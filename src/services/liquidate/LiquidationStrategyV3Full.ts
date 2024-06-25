import { getDecimals } from "@gearbox-protocol/sdk-gov";
import { iCreditFacadeV3Abi } from "@gearbox-protocol/types/abi";
import type { SimulateContractReturnType } from "viem";

import {
  type Balance,
  type CreditAccountData,
  exceptionsAbis,
} from "../../data/index.js";
import { type ILogger, Logger } from "../../log/index.js";
import type { PathFinderCloseResult } from "../../utils/ethers-6-temp/pathfinder/index.js";
import AbstractLiquidationStrategyV3 from "./AbstractLiquidationStrategyV3.js";
import type { ILiquidationStrategy, MakeLiquidatableResult } from "./types.js";

export default class LiquidationStrategyV3Full
  extends AbstractLiquidationStrategyV3
  implements ILiquidationStrategy<PathFinderCloseResult>
{
  public readonly name = "full";
  public readonly adverb = "fully";

  @Logger("LiquidationStrategyV3Full")
  logger!: ILogger;

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
      for (const { token, balance, isEnabled } of ca.allBalances) {
        expectedBalances[token] = { token, balance };
        // filter out dust, we don't want to swap it
        const minBalance = 10n ** BigInt(Math.max(8, getDecimals(token)) - 8);
        // also: gearbox liquidator does not need to swap disabled tokens. third-party liquidators might want to do it
        if (balance < minBalance || !isEnabled) {
          leftoverBalances[token] = { token, balance };
        }
      }
      const result = await this.pathFinder.findBestClosePath({
        creditAccount: ca,
        creditManager: cm,
        expectedBalances,
        leftoverBalances,
        slippage: this.config.slippage,
      });
      if (!result) {
        throw new Error("pathfinder result is empty");
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

  public async simulate(
    account: CreditAccountData,
    preview: PathFinderCloseResult,
  ): Promise<SimulateContractReturnType> {
    return this.client.pub.simulateContract({
      account: this.client.account,
      abi: [...iCreditFacadeV3Abi, ...exceptionsAbis],
      address: account.creditFacade,
      functionName: "liquidateCreditAccount",
      args: [account.addr, this.client.address, preview.calls],
    });
  }
}
