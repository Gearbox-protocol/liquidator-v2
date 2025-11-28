import {
  morphoLiquidatorAbi,
  morphoUnwinderAbi,
} from "@gearbox-protocol/liquidator-contracts/abi";
import {
  MorphoLiquidator_bytecode,
  MorphoUnwinder_bytecode,
} from "@gearbox-protocol/liquidator-contracts/bytecode";
import {
  type CreditSuite,
  type Curator,
  isVersionRange,
  VERSION_RANGE_310,
} from "@gearbox-protocol/sdk";
import { type Address, isAddress } from "viem";

import { MORPHO } from "../constants.js";
import { mustGetCuratorName } from "../utils.js";
import PartialLiquidatorV310Contract from "./PartialLiquidatorV310Contract.js";

export class MorphoLiquidatorV310Contract extends PartialLiquidatorV310Contract {
  #morpho: Address;

  public static tryAttach(
    cm: CreditSuite,
  ): MorphoLiquidatorV310Contract | undefined {
    if (!isVersionRange(cm.router.version, VERSION_RANGE_310)) {
      return undefined;
    }
    const morpho = MORPHO[cm.networkType];
    if (!morpho || !isAddress(morpho)) {
      return undefined;
    }
    const curator = mustGetCuratorName(cm);
    return new MorphoLiquidatorV310Contract(cm.router.address, curator, morpho);
  }

  constructor(router: Address, curator: Curator, morpho: Address) {
    super("Morpho", router, curator);
    this.#morpho = morpho;
  }

  protected async deploy(): Promise<void> {
    const liquidatorAddr =
      this.config.liquidationMode === "deleverage"
        ? await this.#deployUnwinder()
        : await this.#deployLiquidator();

    this.address = liquidatorAddr;
  }

  async #deployLiquidator(): Promise<Address> {
    const { address } = await this.deployer.ensureExists({
      abi: morphoLiquidatorAbi,
      bytecode: MorphoLiquidator_bytecode,
      // constructor(address _owner, address _morpho)
      args: [this.owner, this.#morpho],
    });
    this.logger.debug(`MorphoLiquidator address: ${address}`);
    return address;
  }

  async #deployUnwinder(): Promise<Address> {
    const { address } = await this.deployer.ensureExists({
      abi: morphoUnwinderAbi,
      bytecode: MorphoUnwinder_bytecode,
      // constructor(address _owner, address _morpho)
      args: [this.owner, this.#morpho],
    });
    this.logger.debug(`MorphoUnwinder address: ${address}`);
    return address;
  }
}
