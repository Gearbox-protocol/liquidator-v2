import {
  aaveFlTakerAbi,
  aaveLiquidatorAbi,
} from "@gearbox-protocol/liquidator-v2-contracts/abi";
import {
  AaveFLTaker_bytecode,
  AaveLiquidator_bytecode,
} from "@gearbox-protocol/liquidator-v2-contracts/bytecode";
import { type NetworkType, NOT_DEPLOYED } from "@gearbox-protocol/sdk";
import type { Address } from "viem";

import type { ILogger } from "../../log/index.js";
import { Logger } from "../../log/index.js";
import PartialLiquidatorContract from "./PartialLiquidatorContract.js";

const AAVE_V3_LENDING_POOL: Record<NetworkType, Address> = {
  Mainnet: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
  Arbitrum: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  Optimism: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  Base: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
  Sonic: NOT_DEPLOYED,
};

export default class AAVELiquidatorContract extends PartialLiquidatorContract {
  @Logger("AAVEPartialLiquidator")
  logger!: ILogger;

  constructor(router: Address, bot: Address) {
    super("AAVE Partial Liquidator", router, bot);
  }

  public async deploy(): Promise<void> {
    let address = this.config.aavePartialLiquidatorAddress;
    const aavePool = AAVE_V3_LENDING_POOL[this.config.network];
    if (!address) {
      this.logger.debug(
        { aavePool, router: this.router, bot: this.bot },
        "deploying partial liquidator",
      );

      let hash = await this.client.wallet.deployContract({
        abi: aaveFlTakerAbi,
        bytecode: AaveFLTaker_bytecode,
        args: [aavePool],
      });
      this.logger.debug(`waiting for AaveFLTaker to deploy, tx hash: ${hash}`);
      const { contractAddress: aaveFlTakerAddr } =
        await this.client.pub.waitForTransactionReceipt({
          hash,
          timeout: 120_000,
        });
      if (!aaveFlTakerAddr) {
        throw new Error(`AaveFLTaker was not deployed, tx hash: ${hash}`);
      }
      let owner = await this.client.pub.readContract({
        abi: aaveFlTakerAbi,
        functionName: "owner",
        address: aaveFlTakerAddr,
      });
      this.logger.debug(
        `deployed AaveFLTaker at ${aaveFlTakerAddr} owned by ${owner} in tx ${hash}`,
      );

      hash = await this.client.wallet.deployContract({
        abi: aaveLiquidatorAbi,
        bytecode: AaveLiquidator_bytecode,
        args: [this.router, this.bot, aavePool, aaveFlTakerAddr],
      });
      this.logger.debug(`waiting for liquidator to deploy, tx hash: ${hash}`);
      const { contractAddress: liquidatorAddr } =
        await this.client.pub.waitForTransactionReceipt({
          hash,
          timeout: 120_000,
        });
      if (!liquidatorAddr) {
        throw new Error(`liquidator was not deployed, tx hash: ${hash}`);
      }
      owner = await this.client.pub.readContract({
        abi: aaveLiquidatorAbi,
        address: liquidatorAddr,
        functionName: "owner",
      });
      this.logger.debug(
        `deployed Liquidator at ${liquidatorAddr} owned by ${owner} in tx ${hash}`,
      );

      const receipt = await this.client.simulateAndWrite({
        address: aaveFlTakerAddr,
        abi: aaveFlTakerAbi,
        functionName: "setAllowedFLReceiver",
        args: [liquidatorAddr, true],
      });
      if (receipt.status === "reverted") {
        throw new Error(
          `AaveFLTaker.setAllowedFLReceiver reverted, tx hash: ${receipt.transactionHash}`,
        );
      }
      this.logger.debug(
        `set allowed flashloan receiver on FLTaker ${aaveFlTakerAddr} to ${liquidatorAddr} in tx ${receipt.transactionHash}`,
      );

      address = liquidatorAddr;
    }
    this.logger.info(`partial liquidator contract addesss: ${address}`);
    this.address = address;
  }
}
