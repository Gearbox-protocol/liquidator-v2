import {
  ghoFmTakerAbi,
  ghoLiquidatorAbi,
} from "@gearbox-protocol/liquidator-v2-contracts/abi";
import {
  GhoFMTaker_bytecode,
  GhoLiquidator_bytecode,
} from "@gearbox-protocol/liquidator-v2-contracts/bytecode";
import { tokenDataByNetwork } from "@gearbox-protocol/sdk-gov";
import type { Address } from "viem";

import type { ILogger } from "../../log/index.js";
import { Logger } from "../../log/index.js";
import PartialLiquidatorContract from "./PartialLiquidatorContract.js";

export default class GHOLiquidatorContract extends PartialLiquidatorContract {
  @Logger("GHOPartialLiquidator")
  logger!: ILogger;

  constructor(router: Address, bot: Address) {
    super("GHO Partial Liquidator", router, bot);
  }

  public async deploy(): Promise<void> {
    let address = this.config.ghoPartialLiquidatorAddress;
    if (!address) {
      this.logger.debug(
        {
          ghoFlashMinter: this.ghoFlashMinter,
          router: this.router,
          bot: this.bot,
        },
        "deploying partial liquidator",
      );

      let hash = await this.client.wallet.deployContract({
        abi: ghoFmTakerAbi,
        bytecode: GhoFMTaker_bytecode,
        // constructor(address _ghoFlashMinter, address _gho) {
        args: [
          this.ghoFlashMinter,
          tokenDataByNetwork[this.config.network].GHO,
        ],
      });
      this.logger.debug(`waiting for GhoFMTaker to deploy, tx hash: ${hash}`);
      const { contractAddress: ghoFMTakerAddr } =
        await this.client.pub.waitForTransactionReceipt({
          hash,
          timeout: 120_000,
        });
      if (!ghoFMTakerAddr) {
        throw new Error(`GhoFMTaker was not deployed, tx hash: ${hash}`);
      }
      let owner = await this.client.pub.readContract({
        abi: ghoFmTakerAbi,
        functionName: "owner",
        address: ghoFMTakerAddr,
      });
      this.logger.debug(
        `deployed GhoFMTaker at ${ghoFMTakerAddr} owned by ${owner} in tx ${hash}`,
      );

      hash = await this.client.wallet.deployContract({
        abi: ghoLiquidatorAbi,
        bytecode: GhoLiquidator_bytecode,
        // address _router, address _plb, address _ghoFlashMinter, address _ghoFMTaker, address _gho
        args: [
          this.router,
          this.bot,
          this.ghoFlashMinter,
          ghoFMTakerAddr,
          tokenDataByNetwork[this.config.network].GHO,
        ],
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
        abi: ghoLiquidatorAbi,
        address: liquidatorAddr,
        functionName: "owner",
      });
      this.logger.debug(
        `deployed Liquidator at ${liquidatorAddr} owned by ${owner} in tx ${hash}`,
      );

      const receipt = await this.client.simulateAndWrite({
        address: ghoFMTakerAddr,
        abi: ghoFmTakerAbi,
        functionName: "setAllowedFMReceiver",
        args: [liquidatorAddr, true],
      });
      if (receipt.status === "reverted") {
        throw new Error(
          `GhoFMTaker.setAllowedFMReceiver reverted, tx hash: ${receipt.transactionHash}`,
        );
      }
      this.logger.debug(
        `set allowed flashloan receiver on FMTaker ${ghoFMTakerAddr} to ${liquidatorAddr} in tx ${receipt.transactionHash}`,
      );

      address = liquidatorAddr;
    }
    this.logger.info(`partial liquidator contract addesss: ${address}`);
    this.address = address;
  }

  private get ghoFlashMinter(): Address {
    if (this.config.network === "Mainnet") {
      return "0xb639D208Bcf0589D54FaC24E655C79EC529762B8";
    }
    throw new Error(
      `gho flash minter is not available on ${this.config.network}`,
    );
  }
}
