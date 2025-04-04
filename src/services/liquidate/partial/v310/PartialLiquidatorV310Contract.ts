import { iPartialLiquidatorAbi } from "@gearbox-protocol/next-contracts/abi";
import type { CreditSuite, Curator } from "@gearbox-protocol/sdk";
import { AP_ROUTER, hexEq } from "@gearbox-protocol/sdk";
import type { Address } from "viem";

import { AbstractPartialLiquidatorContract } from "../AbstractPartialLiquidatorContract.js";

export default abstract class PartialLiquidatorV310Contract extends AbstractPartialLiquidatorContract {
  constructor(name: string, router: Address, curator: Curator) {
    super(name, 310, router, curator);
  }

  public static router(cm: CreditSuite): Address | undefined {
    const router = cm.sdk.addressProvider.getLatestInRange(
      AP_ROUTER,
      [310, 319],
    );
    return router?.[0];
  }

  /**
   * Registers router, partial liquidation bot and credit manager addresses in liquidator contract if necessary
   */
  public override async configure(): Promise<void> {
    const currentRouter = await this.client.pub.readContract({
      abi: iPartialLiquidatorAbi,
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
}
