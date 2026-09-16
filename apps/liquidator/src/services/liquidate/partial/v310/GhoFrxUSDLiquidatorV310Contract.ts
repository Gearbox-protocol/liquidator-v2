import {
  ghoFmTakerAbi,
  ghoFrxUsdLiquidatorAbi,
  ghoFrxUsdUnwinderAbi,
} from "@gearbox-protocol/liquidator-contracts/abi";
import {
  GhoFMTaker_bytecode,
  GhoFrxUSDLiquidator_bytecode,
  GhoFrxUSDUnwinder_bytecode,
} from "@gearbox-protocol/liquidator-contracts/bytecode";
import type { CuratorName } from "@gearbox-protocol/sdk/model";
import {
  type CreditSuite,
  isVersionRange,
  VERSION_RANGE_310,
} from "@gearbox-protocol/sdk/onchain";
import type { Address } from "viem";

import { FLASH_MINTERS } from "../constants.js";
import { mustGetCuratorName } from "../utils.js";
import PartialLiquidatorV310Contract from "./PartialLiquidatorV310Contract.js";

export class GhoFrxUSDLiquidatorV310Contract extends PartialLiquidatorV310Contract {
  #flashMinter: Address;

  public static tryAttach(
    cm: CreditSuite,
  ): GhoFrxUSDLiquidatorV310Contract | undefined {
    if (!isVersionRange(cm.router.version, VERSION_RANGE_310)) {
      return undefined;
    }
    if (cm.networkType !== "Mainnet") {
      return undefined;
    }
    const symbol = cm.sdk.tokensMeta.symbol(cm.underlying);
    if (symbol !== "frxUSD") {
      return undefined;
    }
    const flashMinter = FLASH_MINTERS.Mainnet?.GHO;
    if (!flashMinter) {
      return undefined;
    }
    const curator = mustGetCuratorName(cm);
    return new GhoFrxUSDLiquidatorV310Contract(
      cm.router.address,
      curator,
      flashMinter,
    );
  }

  constructor(router: Address, curator: CuratorName, flashMinter: Address) {
    super("frxUSD", router, curator);
    this.#flashMinter = flashMinter;
  }

  protected async deploy(): Promise<void> {
    const gho = this.sdk.tokensMeta.mustFindBySymbol("GHO").addr;
    const { address: ghoFMTakerAddr } = await this.deployer.ensureExists({
      abi: ghoFmTakerAbi,
      bytecode: GhoFMTaker_bytecode,
      // constructor(address _owner, address _ghoFlashMinter, address _gho) {
      args: [this.owner, this.#flashMinter, gho],
    });

    this.logger.debug(
      {
        address: ghoFMTakerAddr,
        flashMinter: this.#flashMinter,
        router: this.router,
        token: "GHO",
      },
      `ensured GhoFMTaker`,
    );

    const liquidatorAddr =
      this.config.liquidationMode === "deleverage"
        ? await this.#deployUnwinder(ghoFMTakerAddr, gho)
        : await this.#deployLiquidator(ghoFMTakerAddr, gho);

    const isAllowed = await this.client.pub.readContract({
      address: ghoFMTakerAddr,
      abi: ghoFmTakerAbi,
      functionName: "allowedFMReceiver",
      args: [liquidatorAddr],
    });
    this.logger.debug(`checked allowedFMReceiver: ${isAllowed}`);

    if (!isAllowed) {
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
    }

    this.address = liquidatorAddr;
  }

  async #deployLiquidator(ghoFMTaker: Address, gho: Address): Promise<Address> {
    const { address } = await this.deployer.ensureExists({
      abi: ghoFrxUsdLiquidatorAbi,
      bytecode: GhoFrxUSDLiquidator_bytecode,
      // constructor(address _owner, address _ghoFlashMinter, address _ghoFMTaker, address _gho)
      args: [this.owner, this.#flashMinter, ghoFMTaker, gho],
    });
    this.logger.debug(`ensured GhoFrxUSDLiquidator at ${address}`);
    return address;
  }

  async #deployUnwinder(ghoFMTaker: Address, gho: Address): Promise<Address> {
    const { address } = await this.deployer.ensureExists({
      abi: ghoFrxUsdUnwinderAbi,
      bytecode: GhoFrxUSDUnwinder_bytecode,
      // constructor(address _owner, address _ghoFlashMinter, address _ghoFMTaker, address _gho)
      args: [this.owner, this.#flashMinter, ghoFMTaker, gho],
    });
    this.logger.debug(`ensured GhoFrxUSDUnwinder at ${address}`);
    return address;
  }
}
