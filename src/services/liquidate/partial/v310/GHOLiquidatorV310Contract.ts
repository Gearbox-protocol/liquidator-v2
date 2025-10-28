import {
  ghoFmTakerAbi,
  ghoLiquidatorAbi,
  ghoUnwinderAbi,
} from "@gearbox-protocol/liquidator-contracts/abi";
import {
  GhoFMTaker_bytecode,
  GhoLiquidator_bytecode,
  GhoUnwinder_bytecode,
} from "@gearbox-protocol/liquidator-contracts/bytecode";
import {
  type CreditSuite,
  type Curator,
  isVersionRange,
  VERSION_RANGE_310,
} from "@gearbox-protocol/sdk";
import type { Address } from "viem";

import { FLASH_MINTERS } from "../constants.js";
import { mustGetCuratorName } from "../utils.js";
import PartialLiquidatorV310Contract from "./PartialLiquidatorV310Contract.js";

type GhoLiquidatorToken = "DOLA" | "GHO" | "NECT";

export class GHOLiquidatorV310Contract extends PartialLiquidatorV310Contract {
  #token: GhoLiquidatorToken;
  #flashMinter: Address;

  public static tryAttach(
    cm: CreditSuite,
  ): GHOLiquidatorV310Contract | undefined {
    if (!isVersionRange(cm.router.version, VERSION_RANGE_310)) {
      return undefined;
    }
    const curator = mustGetCuratorName(cm);
    const symbol = cm.sdk.tokensMeta.symbol(cm.underlying);
    const flashMinter = FLASH_MINTERS[cm.networkType]?.[symbol];
    if (!flashMinter) {
      return undefined;
    }
    switch (symbol) {
      case "GHO":
        return new GHOLiquidatorV310Contract(
          cm.router.address,
          curator,
          "GHO",
          flashMinter,
        );
      case "DOLA":
        return new GHOLiquidatorV310Contract(
          cm.router.address,
          curator,
          "DOLA",
          flashMinter,
        );
      case "NECT":
        return new GHOLiquidatorV310Contract(
          cm.router.address,
          curator,
          "NECT",
          flashMinter,
        );
    }
    return undefined;
  }

  constructor(
    router: Address,
    curator: Curator,
    token: GhoLiquidatorToken,
    flashMinter: Address,
  ) {
    super(token, router, curator);
    this.#token = token;
    this.#flashMinter = flashMinter;
  }

  protected async deploy(): Promise<void> {
    const { address: ghoFMTakerAddr } = await this.deployer.ensureExists({
      abi: ghoFmTakerAbi,
      bytecode: GhoFMTaker_bytecode,
      // constructor(address _owner, address _ghoFlashMinter, address _gho) {
      args: [
        this.owner,
        this.#flashMinter,
        this.sdk.tokensMeta.mustFindBySymbol(this.#token).addr,
      ],
    });

    this.logger.debug(
      {
        address: ghoFMTakerAddr,
        flashMinter: this.#flashMinter,
        router: this.router,
        token: this.#token,
      },
      `ensured GhoFMTaker`,
    );

    const liquidatorAddr =
      this.config.liquidationMode === "deleverage"
        ? await this.#deployUnwinder(ghoFMTakerAddr)
        : await this.#deployLiquidator(ghoFMTakerAddr);

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

  async #deployLiquidator(ghoFMTaker: Address): Promise<Address> {
    const { address } = await this.deployer.ensureExists({
      abi: ghoLiquidatorAbi,
      bytecode: GhoLiquidator_bytecode,
      // constructor(address _owner, address _ghoFlashMinter, address _ghoFMTaker, address _gho)
      args: [
        this.owner,
        this.#flashMinter,
        ghoFMTaker,
        this.sdk.tokensMeta.mustFindBySymbol(this.#token).addr,
      ],
    });
    this.logger.debug(`ensured GHOLiquidator at ${address}`);
    return address;
  }

  async #deployUnwinder(ghoFMTaker: Address): Promise<Address> {
    const { address } = await this.deployer.ensureExists({
      abi: ghoUnwinderAbi,
      bytecode: GhoUnwinder_bytecode,
      // constructor(address _owner, address _ghoFlashMinter, address _ghoFMTaker, address _gho)
      args: [
        this.owner,
        this.#flashMinter,
        ghoFMTaker,
        this.sdk.tokensMeta.mustFindBySymbol(this.#token).addr,
      ],
    });
    this.logger.debug(`ensured GhoUnwinder at ${address}`);
    return address;
  }
}
