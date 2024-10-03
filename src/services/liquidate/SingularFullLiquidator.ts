import type { CreditAccountData, RawTx } from "@gearbox-protocol/sdk";
import { iCreditFacadeV3Abi } from "@gearbox-protocol/types/abi";
import { decodeFunctionData, type SimulateContractReturnType } from "viem";

import { exceptionsAbis } from "../../data/index.js";
import SingularLiquidator from "./SingularLiquidator.js";
import type { MakeLiquidatableResult, StrategyPreview } from "./types.js";

interface SinglularFullPreview extends StrategyPreview {
  amount: bigint;
  minAmount: bigint;
  rawTx: RawTx;
}

export default class SingularFullLiquidator extends SingularLiquidator<SinglularFullPreview> {
  protected readonly name = "full";
  protected readonly adverb = "fully";

  public async makeLiquidatable(
    ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult> {
    // not supported
    return Promise.resolve({});
  }

  public async preview(ca: CreditAccountData): Promise<SinglularFullPreview> {
    try {
      let bestClosePath: Omit<SinglularFullPreview, "rawTx"> | undefined;
      // Can log it here:
      // this.creditAccountService.sdk.once("foundPathOptions", v => {
      //   pathOptions = v.pathOptions;
      // });
      this.creditAccountService.sdk.once(
        "foundBestClosePath",
        ({ creditAccount, ...rest }) => {
          bestClosePath = rest;
        },
      );
      const rawTx = await this.creditAccountService.fullyLiquidate(
        ca,
        this.client.address,
        BigInt(this.config.slippage),
      );
      if (!bestClosePath) {
        throw new Error("cannot find best close path");
      }
      return { ...bestClosePath, rawTx };
    } catch (e) {
      throw new Error("cant preview full liquidation", { cause: e });
    }
  }

  public async simulate(
    account: CreditAccountData,
    preview: SinglularFullPreview,
  ): Promise<SimulateContractReturnType> {
    const { args } = decodeFunctionData({
      abi: iCreditFacadeV3Abi,
      data: preview.rawTx.callData,
    });
    // TODO: create view action for simulateRawTx with abis for exceptions
    return this.client.pub.simulateContract({
      account: this.client.account,
      abi: [...iCreditFacadeV3Abi, ...exceptionsAbis],
      address: account.creditFacade,
      functionName: "liquidateCreditAccount",
      args: args as any,
    }) as any;
  }
}
