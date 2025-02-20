import {
  siloFlTakerAbi,
  siloLiquidatorAbi,
} from "@gearbox-protocol/liquidator-v2-contracts/abi";
import {
  SiloFLTaker_bytecode,
  SiloLiquidator_bytecode,
} from "@gearbox-protocol/liquidator-v2-contracts/bytecode";
import { tokenDataByNetwork } from "@gearbox-protocol/sdk-gov";
import type { Address } from "viem";

import type { ILogger } from "../../log/index.js";
import { Logger } from "../../log/index.js";
import PartialLiquidatorContract from "./PartialLiquidatorContract.js";

const SONIC_USDCE_SILO: Address = "0x322e1d5384aa4ED66AeCa770B95686271de61dc3";
const SONIC_WS_SILO: Address = "0xf55902DE87Bd80c6a35614b48d7f8B612a083C12";

export default class SiloLiquidatorContract extends PartialLiquidatorContract {
  @Logger("SiloPartialLiquidator")
  logger!: ILogger;

  #siloFLTaker: Address | undefined;

  constructor(router: Address, bot: Address) {
    super("Silo Partial Liquidator", router, bot);
  }

  public async deploy(): Promise<void> {
    let address = this.config.siloPartialLiquidatorAddress;
    if (!address) {
      this.logger.debug(
        {
          router: this.router,
          bot: this.bot,
        },
        "deploying partial liquidator",
      );

      let hash = await this.client.wallet.deployContract({
        abi: siloFlTakerAbi,
        bytecode: SiloFLTaker_bytecode,
      });
      this.logger.debug(`waiting for SiloFLTaker to deploy, tx hash: ${hash}`);
      const { contractAddress: siloFLTakerAddr } =
        await this.client.pub.waitForTransactionReceipt({
          hash,
          timeout: 120_000,
        });
      if (!siloFLTakerAddr) {
        throw new Error(`SiloFLTaker was not deployed, tx hash: ${hash}`);
      }
      this.#siloFLTaker = siloFLTakerAddr;
      let owner = await this.client.pub.readContract({
        abi: siloFlTakerAbi,
        functionName: "owner",
        address: this.siloFLTaker,
      });
      this.logger.debug(
        `deployed SiloFLTaker at ${this.siloFLTaker} owned by ${owner} in tx ${hash}`,
      );

      hash = await this.client.wallet.deployContract({
        abi: siloLiquidatorAbi,
        bytecode: SiloLiquidator_bytecode,
        // constructor(address _router, address _plb, address _siloFLTaker) AbstractLiquidator(_router, _plb) {
        args: [this.router, this.bot, this.siloFLTaker],
      });
      this.logger.debug(
        `waiting for SiloLiquidator to deploy, tx hash: ${hash}`,
      );
      const { contractAddress: liquidatorAddr } =
        await this.client.pub.waitForTransactionReceipt({
          hash,
          timeout: 120_000,
        });
      if (!liquidatorAddr) {
        throw new Error(`SiloLiquidator was not deployed, tx hash: ${hash}`);
      }
      owner = await this.client.pub.readContract({
        abi: siloLiquidatorAbi,
        address: liquidatorAddr,
        functionName: "owner",
      });
      this.logger.debug(
        `deployed SiloLiquidator at ${liquidatorAddr} owned by ${owner} in tx ${hash}`,
      );

      // siloFLTaker.setTokenToSilo(tokenTestSuite.addressOf(TOKEN_USDC_e), SONIC_USDCE_SILO);
      // siloFLTaker.setTokenToSilo(tokenTestSuite.addressOf(TOKEN_wS), SONIC_WS_SILO);

      // siloFLTaker.setAllowedFLReceiver(address(liquidator), true);
      const receipt = await this.client.simulateAndWrite({
        address: this.siloFLTaker,
        abi: siloFlTakerAbi,
        functionName: "setAllowedFLReceiver",
        args: [liquidatorAddr, true],
      });
      if (receipt.status === "reverted") {
        throw new Error(
          `SiloFLTaker.setAllowedFLReceiver reverted, tx hash: ${receipt.transactionHash}`,
        );
      }
      this.logger.debug(
        `set allowed flashloan receiver on SiloFLTaker ${this.siloFLTaker} to ${liquidatorAddr} in tx ${receipt.transactionHash}`,
      );

      await this.setTokenToSilo(
        tokenDataByNetwork.Sonic.USDC_e,
        SONIC_USDCE_SILO,
      );
      await this.setTokenToSilo(tokenDataByNetwork.Sonic.wS, SONIC_WS_SILO);

      address = liquidatorAddr;
    }
    this.logger.info(`partial liquidator contract addesss: ${address}`);
    this.address = address;
  }

  public async setTokenToSilo(token: Address, silo: Address): Promise<void> {
    const receipt = await this.client.simulateAndWrite({
      address: this.siloFLTaker,
      abi: siloFlTakerAbi,
      functionName: "setTokenToSilo",
      args: [token, silo],
    });
    if (receipt.status === "reverted") {
      throw new Error(
        `SiloFLTaker.setTokenToSilo(${token}, ${silo}) reverted, tx hash: ${receipt.transactionHash}`,
      );
    }
    this.logger.debug(
      `set token ${token} to silo ${silo} on SiloFLTaker ${this.siloFLTaker} in tx ${receipt.transactionHash}`,
    );
  }

  private get siloFLTaker(): Address {
    if (!this.#siloFLTaker) {
      throw new Error("SiloFLTaker is not deployed");
    }
    return this.#siloFLTaker;
  }
}
