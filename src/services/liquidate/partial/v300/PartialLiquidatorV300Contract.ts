import { iPartialLiquidatorAbi } from "@gearbox-protocol/liquidator-v2-contracts/abi";
import type {
  CreditAccountData,
  CreditSuite,
  Curator,
  OnDemandPriceUpdate,
} from "@gearbox-protocol/sdk";
import { ADDRESS_0X0, hexEq } from "@gearbox-protocol/sdk";
import type { Address, SimulateContractReturnType } from "viem";
import { parseAbi } from "viem";

import type { PartialV300ConfigSchema } from "../../../../config/index.js";
import { exceptionsAbis } from "../../../../data/index.js";
import type { PartialLiquidationPreview } from "../../types.js";
import { AbstractPartialLiquidatorContract } from "../AbstractPartialLiquidatorContract.js";
import type {
  OptimalPartialLiquidation,
  RawPartialLiquidationPreview,
} from "../types.js";
import { V300_PARTIAL_LIQUIDATOR_BOTS } from "./constants.js";

export default abstract class PartialLiquidatorV300Contract extends AbstractPartialLiquidatorContract {
  #bot: Address;
  protected readonly configAddress?: Address;

  constructor(
    name: string,
    router: Address,
    curator: Curator,
    configAddress: keyof PartialV300ConfigSchema,
  ) {
    super(name, 300, router, curator);
    this.#bot = V300_PARTIAL_LIQUIDATOR_BOTS[curator];
    this.configAddress = this.config[configAddress];
  }

  public async deploy(): Promise<void> {
    if (this.configAddress) {
      this.logger.debug(`found address in config: ${this.configAddress}`);
    }
  }

  /**
   * Registers router, partial liquidation bot and credit manager addresses in liquidator contract if necessary
   */
  public override async configure(): Promise<void> {
    const [currentRouter, currentBot] = await this.client.pub.multicall({
      contracts: [
        {
          // abi: iPartialLiquidatorAbi,
          abi: parseAbi(["function router() view returns (address)"]),
          address: this.address,
          functionName: "router",
        },
        {
          // abi: iPartialLiquidatorAbi,
          abi: parseAbi([
            "function partialLiquidationBot() view returns (address)",
          ]),
          address: this.address,
          functionName: "partialLiquidationBot",
        },
      ],
      allowFailure: false,
    });

    if (!hexEq(currentRouter, this.router)) {
      this.logger.warn(
        `need to update router from ${currentRouter} to ${this.router}`,
      );
      await this.updateRouterAddress(this.router);
    }

    if (!hexEq(this.bot, currentBot)) {
      this.logger.warn(`need to update bot from ${currentBot} to ${this.bot}`);
      const receipt = await this.client.simulateAndWrite({
        abi: iPartialLiquidatorAbi,
        address: this.address,
        functionName: "setPartialLiquidationBot",
        args: [this.bot],
      });
      if (receipt.status === "reverted") {
        throw new Error(
          `PartialLiquidator.setPartialLiquidationBot(${this.bot}) tx ${receipt.transactionHash} reverted`,
        );
      }
      this.logger.info(
        `set bot to ${this.bot} in tx ${receipt.transactionHash}`,
      );
    }

    await super.configure();
  }

  public async getOptimalLiquidation(
    creditAccount: Address,
    priceUpdates: Pick<OnDemandPriceUpdate, "data" | "token" | "reserve">[],
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
    priceUpdates: Pick<OnDemandPriceUpdate, "data" | "token" | "reserve">[],
  ): Promise<RawPartialLiquidationPreview> {
    const connectors = this.sdk
      .routerFor(cm)
      .getAvailableConnectors(cm.creditManager.collateralTokens);

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
        connectors,
        BigInt(this.config.slippage),
      ],
    });

    return preview;
  }

  public async partialLiquidateAndConvert(
    account: CreditAccountData,
    preview: PartialLiquidationPreview,
  ): Promise<SimulateContractReturnType<unknown[], any, any>> {
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

  protected get bot(): Address {
    return this.#bot;
  }
}
