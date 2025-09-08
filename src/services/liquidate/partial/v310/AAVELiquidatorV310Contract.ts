import {
  aaveFlTakerAbi,
  aaveLiquidatorAbi,
  aaveUnwinderAbi,
} from "@gearbox-protocol/liquidator-contracts/abi";
import {
  AaveFLTaker_bytecode,
  AaveLiquidator_bytecode,
  AaveUnwinder_bytecode,
} from "@gearbox-protocol/liquidator-contracts/bytecode";
import {
  type CreditSuite,
  type Curator,
  isVersionRange,
  VERSION_RANGE_310,
} from "@gearbox-protocol/sdk";
import { type Address, isAddress } from "viem";

import { AAVE_V3_LENDING_POOL } from "../constants.js";
import { mustGetCuratorName } from "../utils.js";
import PartialLiquidatorV310Contract from "./PartialLiquidatorV310Contract.js";

export class AAVELiquidatorV310Contract extends PartialLiquidatorV310Contract {
  #aavePool: Address;

  public static tryAttach(
    cm: CreditSuite,
  ): AAVELiquidatorV310Contract | undefined {
    if (!isVersionRange(cm.router.version, VERSION_RANGE_310)) {
      return undefined;
    }
    const aavePool = AAVE_V3_LENDING_POOL[cm.provider.networkType];
    if (!aavePool || !isAddress(aavePool)) {
      return undefined;
    }
    const curator = mustGetCuratorName(cm);
    const symbol = cm.sdk.tokensMeta.symbol(cm.underlying);
    switch (symbol) {
      case "GHO":
      case "DOLA":
        return undefined;
      default:
        return new AAVELiquidatorV310Contract(
          cm.router.address,
          curator,
          aavePool,
        );
    }
  }

  constructor(router: Address, curator: Curator, aavePool: Address) {
    super("Aave", router, curator);
    this.#aavePool = aavePool;
  }

  protected async deploy(): Promise<void> {
    const { address: aaveFlTakerAddr } = await this.deployer.ensureExists({
      abi: aaveFlTakerAbi,
      bytecode: AaveFLTaker_bytecode,
      // constructor(address _owner, address _aavePool)
      args: [this.owner, this.#aavePool],
    });
    this.logger.debug(`AaveFLTaker address: ${aaveFlTakerAddr}`);

    const liquidatorAddr =
      this.config.liquidationMode === "deleverage"
        ? await this.#deployUnwinder(aaveFlTakerAddr)
        : await this.#deployLiquidator(aaveFlTakerAddr);

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

  async #deployLiquidator(flTaker: Address): Promise<Address> {
    const { address } = await this.deployer.ensureExists({
      abi: aaveLiquidatorAbi,
      bytecode: AaveLiquidator_bytecode,
      // constructor(address _owner, address _aavePool, address _aaveFLTaker)
      args: [this.owner, this.#aavePool, flTaker],
    });
    this.logger.debug(`AaveLiquidator address: ${address}`);
    return address;
  }

  async #deployUnwinder(flTaker: Address): Promise<Address> {
    const { address } = await this.deployer.ensureExists({
      abi: aaveUnwinderAbi,
      bytecode: AaveUnwinder_bytecode,
      // constructor(address _owner, address _aavePool, address _aaveFLTaker)
      args: [this.owner, this.#aavePool, flTaker],
    });
    this.logger.debug(`AaveUnwinder address: ${address}`);
    return address;
  }
}
