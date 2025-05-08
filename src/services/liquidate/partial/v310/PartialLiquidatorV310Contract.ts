import { iPartialLiquidatorAbi } from "@gearbox-protocol/next-contracts/abi";
import type {
  CreditAccountData,
  CreditSuite,
  Curator,
  OnDemandPriceUpdate,
} from "@gearbox-protocol/sdk";
import { ADDRESS_0X0, hexEq } from "@gearbox-protocol/sdk";
import { type Address, parseAbi, type SimulateContractReturnType } from "viem";

import { exceptionsAbis } from "../../../../data/index.js";
import type { PartialLiquidationPreview } from "../../types.js";
import { AbstractPartialLiquidatorContract } from "../AbstractPartialLiquidatorContract.js";
import type {
  OptimalPartialLiquidation,
  RawPartialLiquidationPreview,
} from "../types.js";

export default abstract class PartialLiquidatorV310Contract extends AbstractPartialLiquidatorContract {
  constructor(name: string, router: Address, curator: Curator) {
    super(name, 310, router, curator);
  }

  /**
   * Registers router, partial liquidation bot and credit manager addresses in liquidator contract if necessary
   */
  public override async configure(): Promise<void> {
    const currentRouter = await this.client.pub.readContract({
      abi: parseAbi(["function router() view returns (address)"]),
      address: this.address,
      functionName: "router",
    });

    if (!hexEq(currentRouter, this.router)) {
      this.logger.warn(
        `need to update router from ${currentRouter} to ${this.router}`,
      );
      await this.updateRouterAddress(this.router);
    }
    await super.configure();
  }

  public async getOptimalLiquidation(
    creditAccount: Address,
    priceUpdates: OnDemandPriceUpdate[],
  ): Promise<OptimalPartialLiquidation> {
    const {
      result: [
        tokenOut,
        optimalAmount,
        repaidAmount,
        flashLoanAmount,
        isOptimalRepayable,
      ],
    } = await this.client.pub.simulateContract({
      account: this.client.account,
      abi: [...iPartialLiquidatorAbi, ...exceptionsAbis],
      address: this.address,
      functionName: "getOptimalLiquidation",
      args: [creditAccount, 10100n, priceUpdates],
    });
    return {
      tokenOut,
      optimalAmount,
      repaidAmount,
      flashLoanAmount,
      isOptimalRepayable,
    };
  }

  public async previewPartialLiquidation(
    ca: CreditAccountData,
    cm: CreditSuite,
    optimalLiquidation: OptimalPartialLiquidation,
    priceUpdates: OnDemandPriceUpdate[],
  ): Promise<RawPartialLiquidationPreview> {
    const { result: preview } = await this.client.pub.simulateContract({
      account: ADDRESS_0X0,
      address: this.address,
      abi: [...iPartialLiquidatorAbi, ...exceptionsAbis],
      functionName: "previewPartialLiquidation",
      args: [
        ca.creditManager,
        ca.creditAccount,
        optimalLiquidation.tokenOut,
        optimalLiquidation.optimalAmount,
        optimalLiquidation.flashLoanAmount,
        priceUpdates,
        BigInt(this.config.slippage),
        4n, // TODO: splits
      ],
    });

    return preview;
  }

  public async partialLiquidateAndConvert(
    account: CreditAccountData,
    preview: PartialLiquidationPreview,
  ): Promise<SimulateContractReturnType> {
    return this.client.pub.simulateContract({
      account: this.client.account,
      address: this.address,
      abi: [...iPartialLiquidatorAbi, ...exceptionsAbis],
      functionName: "partialLiquidateAndConvert",
      args: [
        account.creditManager,
        account.creditAccount,
        preview.assetOut,
        preview.amountOut,
        preview.flashLoanAmount,
        preview.priceUpdates,
        preview.calls,
      ],
    });
  }
}
