import type { Curator } from "@gearbox-protocol/sdk";
import { hexEq } from "@gearbox-protocol/sdk";
import { type Address, parseAbi } from "viem";

import { AbstractPartialLiquidatorContract } from "../AbstractPartialLiquidatorContract.js";

export default abstract class PartialLiquidatorV310Contract extends AbstractPartialLiquidatorContract {
  constructor(name: string, router: Address, curator: Curator) {
    super(name, 310, router, curator);
  }

  /**
   * Registers router, partial liquidation bot and credit manager addresses in liquidator contract if necessary
   */
  public override async configure(): Promise<void> {
    const currentRouter = await this.client.pub.readContract({
      // abi: iPartialLiquidatorAbi,
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
}
