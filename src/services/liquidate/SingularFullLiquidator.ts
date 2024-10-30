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

  // constructor() {
  // super();
  // this.creditAccountService.sdk.router.addHook("foundPathOptions", e => {
  //   this.logger.debug(
  //     { account: e.creditAccount, ...e },
  //     "found path options",
  //   );
  // });
  // }

  public async makeLiquidatable(
    _ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult> {
    // not supported
    return Promise.resolve({});
  }

  public async preview(ca: CreditAccountData): Promise<SinglularFullPreview> {
    try {
      const { tx, routerCloseResult, calls } =
        await this.creditAccountService.fullyLiquidate(
          ca,
          this.client.address,
          BigInt(this.config.slippage),
        );
      return { ...routerCloseResult, calls, rawTx: tx };
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
