import {
  ghoFmTakerAbi,
  ghoLiquidatorAbi,
} from "@gearbox-protocol/liquidator-v2-contracts/abi";
import {
  GhoFMTaker_bytecode,
  GhoLiquidator_bytecode,
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
import { FLASH_MINTERS } from "../constants.js";
import { mustGetCuratorName } from "../utils.js";
import PartialLiquidatorV300Contract from "./PartialLiquidatorV300Contract.js";

export class GHOLiquidatorV300Contract extends PartialLiquidatorV300Contract {
  #token: "DOLA" | "GHO";
  #flashMinter: Address;

  public static tryAttach(
    cm: CreditSuite,
  ): GHOLiquidatorV300Contract | undefined {
    const config: Config = DI.get(DI.Config);
    if (config.liquidationMode === "deleverage") {
      return undefined;
    }
    if (!isVersionRange(cm.router.version, VERSION_RANGE_300)) {
      return undefined;
    }
    const curator = mustGetCuratorName(cm);
    const symbol = cm.sdk.tokensMeta.symbol(cm.underlying);
    const flashMinter = FLASH_MINTERS[cm.networkType]?.[symbol];
    if (!flashMinter) {
      return undefined;
    }
    let result: GHOLiquidatorV300Contract | undefined;
    switch (symbol) {
      case "GHO":
        result = new GHOLiquidatorV300Contract(
          cm.router.address,
          curator,
          "GHO",
          flashMinter,
        );
        break;
      case "DOLA":
        result = new GHOLiquidatorV300Contract(
          cm.router.address,
          curator,
          "DOLA",
          flashMinter,
        );
        break;
    }
    return result;
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

  protected async deploy(): Promise<void> {
    await super.deploy();
    let address = this.configAddress;
    if (!address) {
      this.logger.debug(
        {
          flashMinter: this.#flashMinter,
          router: this.router,
          bot: this.partialLiquidationBot,
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
          this.partialLiquidationBot,
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
    this.address = address;
  }

  public override get envVariables(): Record<string, string> {
    return { [`${this.#token}_PARTIAL_LIQUIDATOR_ADDRESS`]: this.address };
  }
}
