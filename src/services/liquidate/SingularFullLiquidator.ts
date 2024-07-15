import { iCreditFacadeV3Abi } from "@gearbox-protocol/types/abi";
import type { SimulateContractReturnType } from "viem";

import { type CreditAccountData, exceptionsAbis } from "../../data/index.js";
import type { PathFinderCloseResult } from "../../utils/ethers-6-temp/pathfinder/index.js";
import SingularLiquidator from "./SingularLiquidator.js";
import type { MakeLiquidatableResult } from "./types.js";

export default class SingularFullLiquidator extends SingularLiquidator<PathFinderCloseResult> {
  protected readonly name = "full";
  protected readonly adverb = "fully";

  public async makeLiquidatable(
    ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult> {
    // not supported
    return Promise.resolve({});
  }

  public async preview(ca: CreditAccountData): Promise<PathFinderCloseResult> {
    try {
      const cm = await this.getCreditManagerData(ca.creditManager);

      const result = await this.pathFinder.findBestClosePath(
        ca,
        cm,
        this.config.slippage,
      );
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
