import {
  siloFlTakerAbi,
  siloLiquidatorAbi,
} from "@gearbox-protocol/liquidator-v2-contracts/abi";
import {
  SiloFLTaker_bytecode,
  SiloLiquidator_bytecode,
} from "@gearbox-protocol/liquidator-v2-contracts/bytecode";
import {
  type CreditSuite,
  type Curator,
  isVersionRange,
  VERSION_RANGE_300,
} from "@gearbox-protocol/sdk";
import type { Address } from "viem";
import type { Config } from "../../../../config/index.js";
import { DI } from "../../../../di.js";
import { SONIC_USDCE_SILO, SONIC_WS_SILO } from "../constants.js";
import { mustGetCuratorName } from "../utils.js";
import PartialLiquidatorV300Contract from "./PartialLiquidatorV300Contract.js";

export class SiloLiquidatorV300Contract extends PartialLiquidatorV300Contract {
  #siloFLTaker: Address | undefined;

  public static tryAttach(
    cm: CreditSuite,
  ): SiloLiquidatorV300Contract | undefined {
    const config: Config = DI.get(DI.Config);
    if (config.liquidationMode === "deleverage") {
      return undefined;
    }
    if (!isVersionRange(cm.router.version, VERSION_RANGE_300)) {
      return undefined;
    }
    if (cm.networkType !== "Sonic") {
      return undefined;
    }
    const curator = mustGetCuratorName(cm);
    const result = new SiloLiquidatorV300Contract(cm.router.address, curator);
    return result;
  }

  constructor(router: Address, curator: Curator) {
    super("Silo", router, curator, "siloPartialLiquidatorAddress");
  }

  protected async deploy(): Promise<void> {
    await super.deploy();
    let address = this.configAddress;
    if (!address) {
      this.logger.debug(
        {
          router: this.router,
          bot: this.partialLiquidationBot,
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
        args: [this.router, this.partialLiquidationBot, this.siloFLTaker],
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

      await this.#setTokenToSilo("USDC.e", SONIC_USDCE_SILO);
      await this.#setTokenToSilo("wS", SONIC_WS_SILO);

      address = liquidatorAddr;
    }
    this.address = address;
  }

  async #setTokenToSilo(symbol: string, silo: Address): Promise<void> {
    const token = this.sdk.tokensMeta.mustFindBySymbol(symbol).addr;
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

  public override get envVariables(): Record<string, string> {
    return { SILO_PARTIAL_LIQUIDATOR_ADDRESS: this.address };
  }
}
