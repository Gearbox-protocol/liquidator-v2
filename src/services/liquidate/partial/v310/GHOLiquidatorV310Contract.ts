import {
  ghoFmTakerAbi,
  ghoLiquidatorAbi,
} from "@gearbox-protocol/next-contracts/abi";
import {
  GhoFMTaker_bytecode,
  GhoLiquidator_bytecode,
} from "@gearbox-protocol/next-contracts/bytecode";
import type { CreditSuite, Curator } from "@gearbox-protocol/sdk";
import { Create2Deployer } from "@gearbox-protocol/sdk/dev";
import type { Address } from "viem";

import { FLASH_MINTERS } from "../constants.js";
import PartialLiquidatorV310Contract from "./PartialLiquidatorV310Contract.js";

export class GHOLiquidatorV310Contract extends PartialLiquidatorV310Contract {
  #token: "DOLA" | "GHO";
  #flashMinter: Address;

  public static tryAttach(
    cm: CreditSuite,
  ): GHOLiquidatorV310Contract | undefined {
    if (cm.router.version < 310 || cm.router.version > 319) {
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
    }
    return undefined;
  }

  constructor(
    router: Address,
    curator: Curator,
    token: "DOLA" | "GHO",
    flashMinter: Address,
  ) {
    super(token, router, curator);
    this.#token = token;
    this.#flashMinter = flashMinter;
  }

  public async deploy(): Promise<void> {
    const deployer = new Create2Deployer(this.sdk, this.client.wallet);
    const { address: ghoFMTakerAddr } = await deployer.ensureExists({
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

    const { address: liquidatorAddr } = await deployer.ensureExists({
      abi: ghoLiquidatorAbi,
      bytecode: GhoLiquidator_bytecode,
      // constructor(address _owner, address _ghoFlashMinter, address _ghoFMTaker, address _gho)
      args: [
        this.owner,
        this.#flashMinter,
        ghoFMTakerAddr,
        this.sdk.tokensMeta.mustFindBySymbol(this.#token).addr,
      ],
    });
    this.logger.debug(`ensured GHOLiquidator at ${liquidatorAddr}`);

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
}
