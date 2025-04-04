import {
  aaveFlTakerAbi,
  aaveLiquidatorAbi,
} from "@gearbox-protocol/next-contracts/abi";
import {
  AaveFLTaker_bytecode,
  AaveLiquidator_bytecode,
} from "@gearbox-protocol/next-contracts/bytecode";
import type { CreditSuite, Curator } from "@gearbox-protocol/sdk";
import { Create2Deployer } from "@gearbox-protocol/sdk/dev";
import { type Address, isAddress } from "viem";

import { AAVE_V3_LENDING_POOL } from "../constants.js";
import PartialLiquidatorV310Contract from "./PartialLiquidatorV310Contract.js";

export class AAVELiquidatorV310Contract extends PartialLiquidatorV310Contract {
  #aavePool: Address;

  public static tryAttach(
    cm: CreditSuite,
  ): AAVELiquidatorV310Contract | undefined {
    const router = PartialLiquidatorV310Contract.router(cm);
    if (!router) {
      return undefined;
    }
    const aavePool = AAVE_V3_LENDING_POOL[cm.provider.networkType];
    if (!isAddress(aavePool)) {
      return undefined;
    }
    const curator = cm.name.includes("K3") ? "K3" : "Chaos Labs";
    const symbol = cm.sdk.tokensMeta.symbol(cm.underlying);
    switch (symbol) {
      case "GHO":
      case "DOLA":
        return undefined;
      default:
        return new AAVELiquidatorV310Contract(router, curator, aavePool);
    }
  }

  constructor(router: Address, curator: Curator, aavePool: Address) {
    super("Aave", router, curator);
    this.#aavePool = aavePool;
  }

  public async deploy(): Promise<void> {
    const deployer = new Create2Deployer(this.sdk, this.client.wallet);

    const { address: aaveFlTakerAddr } = await deployer.ensureExists({
      abi: aaveFlTakerAbi,
      bytecode: AaveFLTaker_bytecode,
      args: [this.#aavePool],
    });
    this.logger.debug(`AaveFLTaker address: ${aaveFlTakerAddr}`);

    const { address: liquidatorAddr } = await deployer.ensureExists({
      abi: aaveLiquidatorAbi,
      bytecode: AaveLiquidator_bytecode,
      // constructor(address _router, address _aavePool, address _aaveFLTaker)
      args: [this.router, this.#aavePool, aaveFlTakerAddr],
    });
    this.logger.debug(`AaveLiquidator address: ${liquidatorAddr}`);

    const isAllowed = await this.client.pub.readContract({
      address: aaveFlTakerAddr,
      abi: aaveFlTakerAbi,
      functionName: "allowedFLReceiver",
      args: [liquidatorAddr],
    });
    this.logger.debug(`allowedFLReceiver check: ${isAllowed}`);

    if (!isAllowed) {
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
    }

    this.address = liquidatorAddr;
  }
}
