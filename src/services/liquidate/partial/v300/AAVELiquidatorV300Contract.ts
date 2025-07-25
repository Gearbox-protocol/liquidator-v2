import {
  aaveFlTakerAbi,
  aaveLiquidatorAbi,
} from "@gearbox-protocol/liquidator-v2-contracts/abi";
import {
  AaveFLTaker_bytecode,
  AaveLiquidator_bytecode,
} from "@gearbox-protocol/liquidator-v2-contracts/bytecode";
import type { CreditSuite, Curator } from "@gearbox-protocol/sdk";
import { type Address, isAddress } from "viem";

import { AAVE_V3_LENDING_POOL } from "../constants.js";
import PartialLiquidatorV300Contract from "./PartialLiquidatorV300Contract.js";

export class AAVELiquidatorV300Contract extends PartialLiquidatorV300Contract {
  #aavePool: Address;

  public static tryAttach(
    cm: CreditSuite,
  ): AAVELiquidatorV300Contract | undefined {
    if (cm.router.version < 300 || cm.router.version > 309) {
      return undefined;
    }
    const aavePool = AAVE_V3_LENDING_POOL[cm.provider.networkType];
    if (!aavePool || !isAddress(aavePool)) {
      return undefined;
    }
    const curator = cm.name.includes("K3") ? "K3" : "Chaos Labs";
    const symbol = cm.sdk.tokensMeta.symbol(cm.underlying);
    let result: AAVELiquidatorV300Contract | undefined;
    switch (symbol) {
      case "GHO":
      case "DOLA":
        result = undefined;
        break;
      default:
        result = new AAVELiquidatorV300Contract(
          cm.router.address,
          curator,
          aavePool,
        );
        break;
    }
    // if (result?.config.liquidationMode === "deleverage") {
    //   return undefined;
    // }
    return result;
  }

  constructor(router: Address, curator: Curator, aavePool: Address) {
    const key =
      curator === "K3"
        ? "nexoPartialLiquidatorAddress"
        : "aavePartialLiquidatorAddress";
    super("Aave", router, curator, key);
    this.#aavePool = aavePool;
  }

  protected async deploy(): Promise<void> {
    await super.deploy();
    let address = this.configAddress;
    if (!address) {
      this.logger.debug(
        {
          aavePool: this.#aavePool,
          router: this.router,
          bot: this.partialLiquidationBot,
        },
        "deploying partial liquidator",
      );

      let hash = await this.client.wallet.deployContract({
        abi: aaveFlTakerAbi,
        bytecode: AaveFLTaker_bytecode,
        args: [this.#aavePool],
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
        args: [
          this.router,
          this.partialLiquidationBot,
          this.#aavePool,
          aaveFlTakerAddr,
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
    this.address = address;
  }

  public override get envVariables(): Record<string, string> {
    return { AAVE_PARTIAL_LIQUIDATOR_ADDRESS: this.address };
  }
}
