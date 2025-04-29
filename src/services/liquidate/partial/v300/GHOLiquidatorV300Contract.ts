import {
  ghoFmTakerAbi,
  ghoLiquidatorAbi,
} from "@gearbox-protocol/liquidator-v2-contracts/abi";
import {
  GhoFMTaker_bytecode,
  GhoLiquidator_bytecode,
} from "@gearbox-protocol/liquidator-v2-contracts/bytecode";
import type { CreditSuite, Curator } from "@gearbox-protocol/sdk";
import type { Address } from "viem";

import { FLASH_MINTERS } from "../constants.js";
import PartialLiquidatorV300Contract from "./PartialLiquidatorV300Contract.js";

export class GHOLiquidatorV300Contract extends PartialLiquidatorV300Contract {
  #token: "DOLA" | "GHO";
  #flashMinter: Address;

  public static tryAttach(
    cm: CreditSuite,
  ): GHOLiquidatorV300Contract | undefined {
    if (cm.router.version < 300 || cm.router.version > 309) {
      return undefined;
    }
    const curator = cm.name.includes("K3") ? "K3" : "Chaos Labs";
    const symbol = cm.sdk.tokensMeta.symbol(cm.underlying);
    const flashMinter = FLASH_MINTERS[cm.provider.networkType]?.[symbol];
    if (!flashMinter) {
      return undefined;
    }
    switch (symbol) {
      case "GHO":
        return new GHOLiquidatorV300Contract(
          cm.router.address,
          curator,
          "GHO",
          flashMinter,
        );
      case "DOLA":
        return new GHOLiquidatorV300Contract(
          cm.router.address,
          curator,
          "DOLA",
          flashMinter,
        );
    }
    return undefined;
  }

  constructor(
    router: Address,
    curator: Curator,
    token: "DOLA" | "GHO",
    flashMinter: Address,
  ) {
    const key =
      token === "GHO"
        ? "ghoPartialLiquidatorAddress"
        : "dolaPartialLiquidatorAddress";
    super(token, router, curator, key);
    this.#token = token;
    this.#flashMinter = flashMinter;
  }

  public async deploy(): Promise<void> {
    await super.deploy();
    let address = this.configAddress;
    if (!address) {
      this.logger.debug(
        {
          flashMinter: this.#flashMinter,
          router: this.router,
          bot: this.bot,
          token: this.#token,
        },
        "deploying partial liquidator",
      );

      let hash = await this.client.wallet.deployContract({
        abi: ghoFmTakerAbi,
        bytecode: GhoFMTaker_bytecode,
        // constructor(address _ghoFlashMinter, address _gho) {
        args: [
          this.#flashMinter,
          this.creditAccountService.sdk.tokensMeta.mustFindBySymbol(this.#token)
            .addr,
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
          this.#flashMinter,
          ghoFMTakerAddr,
          this.sdk.tokensMeta.mustFindBySymbol(this.#token).addr,
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

  public override get envVariables(): Record<string, string> {
    return { [`${this.#token}_PARTIAL_LIQUIDATOR_ADDRESS`]: this.address };
  }
}
