import {
  AddressMap,
  type CreditAccountData,
  type RawTx,
  type RouterHooks,
} from "@gearbox-protocol/sdk";
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

  #bestClosePath = new AddressMap<RouterHooks["foundBestClosePath"][0]>();

  constructor() {
    super();
    this.creditAccountService.sdk.router.addHook("foundBestClosePath", e =>
      this.#bestClosePath.upsert(e.creditAccount, e),
    );
  }

  public async makeLiquidatable(
    _ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult> {
    // not supported
    return Promise.resolve({});
  }

  public async preview(ca: CreditAccountData): Promise<SinglularFullPreview> {
    try {
      const rawTx = await this.creditAccountService.fullyLiquidate(
        ca,
        this.client.address,
        BigInt(this.config.slippage),
      );
      return { ...this.#bestClosePath.mustGet(ca.creditAccount), rawTx };
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
