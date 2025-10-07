import {
  type CreditAccountData,
  VERSION_RANGE_310,
} from "@gearbox-protocol/sdk";
import { iCreditFacadeV3Abi } from "@gearbox-protocol/types/abi";
import {
  BaseError,
  decodeFunctionData,
  type SimulateContractReturnType,
} from "viem";
import type { FullLiquidatorSchema } from "../../config/index.js";
import { exceptionsAbis } from "../../data/index.js";
import SingularLiquidator from "./SingularLiquidator.js";
import type {
  FullLiquidationPreview,
  MakeLiquidatableResult,
} from "./types.js";

export default class SingularFullLiquidator extends SingularLiquidator<
  FullLiquidationPreview,
  FullLiquidatorSchema
> {
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

  public async preview(ca: CreditAccountData): Promise<FullLiquidationPreview> {
    try {
      const isV310 = this.checkAccountVersion(ca, VERSION_RANGE_310);
      const ignoreReservePrices = !this.config.updateReservePrices && isV310;
      const { tx, routerCloseResult, calls } =
        await this.creditAccountService.fullyLiquidate({
          account: ca,
          to: this.client.address,
          slippage: BigInt(this.config.slippage),
          keepAssets: this.config.keepAssets,
          ignoreReservePrices,
        });
      return { ...routerCloseResult, calls, rawTx: tx };
    } catch (e) {
      throw new BaseError("cant preview full liquidation", {
        cause: e as Error,
      });
    }
  }

  public async simulate(
    account: CreditAccountData,
    preview: FullLiquidationPreview,
  ): Promise<SimulateContractReturnType<unknown[], any, any>> {
    const { args } = decodeFunctionData({
      abi: iCreditFacadeV3Abi,
      data: preview.rawTx.callData,
    });
    return this.client.pub.simulateContract({
      account: this.client.account,
      abi: [...iCreditFacadeV3Abi, ...exceptionsAbis],
      address: account.creditFacade,
      functionName: "liquidateCreditAccount",
      args: args as any,
    });
  }
}
