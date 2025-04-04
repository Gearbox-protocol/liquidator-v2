import { iPartialLiquidatorAbi } from "@gearbox-protocol/liquidator-v2-contracts/abi";
import type { CreditSuite, Curator } from "@gearbox-protocol/sdk";
import { AP_ROUTER, hexEq } from "@gearbox-protocol/sdk";
import type { Address } from "viem";

import type { PartialV300ConfigSchema } from "../../../../config/index.js";
import { AbstractPartialLiquidatorContract } from "../AbstractPartialLiquidatorContract.js";
import { V300_PARTIAL_LIQUIDATOR_BOTS } from "./constants.js";

export default abstract class PartialLiquidatorV300Contract extends AbstractPartialLiquidatorContract {
  #bot: Address;
  protected readonly configAddress?: Address;

  public static router(cm: CreditSuite): Address | undefined {
    const router = cm.sdk.addressProvider.getLatestInRange(
      AP_ROUTER,
      [300, 309],
    );
    return router?.[0];
  }

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

  /**
   * Registers router, partial liquidation bot and credit manager addresses in liquidator contract if necessary
   */
  public override async configure(): Promise<void> {
    const [currentRouter, currentBot] = await this.client.pub.multicall({
      contracts: [
        {
          abi: iPartialLiquidatorAbi,
          address: this.address,
          functionName: "router",
        },
        {
          abi: iPartialLiquidatorAbi,
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

  protected get bot(): Address {
    return this.#bot;
  }
}
