import {
  aaveFlTakerAbi,
  aaveFrxUsdLiquidatorAbi,
  aaveFrxUsdUnwinderAbi,
} from "@gearbox-protocol/liquidator-contracts/abi";
import {
  AaveFLTaker_bytecode,
  AaveFrxUSDLiquidator_bytecode,
  AaveFrxUSDUnwinder_bytecode,
} from "@gearbox-protocol/liquidator-contracts/bytecode";
import type { CuratorName } from "@gearbox-protocol/sdk/model";
import {
  type CreditSuite,
  isVersionRange,
  VERSION_RANGE_310,
} from "@gearbox-protocol/sdk/onchain";
import { type Address, isAddress } from "viem";

import { AAVE_V3_LENDING_POOL } from "../constants.js";
import { mustGetCuratorName } from "../utils.js";
import PartialLiquidatorV310Contract from "./PartialLiquidatorV310Contract.js";

export class AaveFrxUSDLiquidatorV310Contract extends PartialLiquidatorV310Contract {
  #aavePool: Address;

  public static tryAttach(
    cm: CreditSuite,
  ): AaveFrxUSDLiquidatorV310Contract | undefined {
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
    const aavePool = AAVE_V3_LENDING_POOL.Mainnet;
    if (!aavePool || !isAddress(aavePool)) {
      return undefined;
    }
    const curator = mustGetCuratorName(cm);
    return new AaveFrxUSDLiquidatorV310Contract(
      cm.router.address,
      curator,
      aavePool,
    );
  }

  constructor(router: Address, curator: CuratorName, aavePool: Address) {
    super("frxUSD", router, curator);
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
    const { address, hash } = await this.deployer.ensureExists({
      abi: aaveFrxUsdLiquidatorAbi,
      bytecode: AaveFrxUSDLiquidator_bytecode,
      // constructor(address _owner, address _aavePool, address _aaveFLTaker)
      args: [this.owner, this.#aavePool, flTaker],
    });
    this.report.recordContract({
      name: this.name,
      address,
      deployed: !!hash,
    });
    this.logger.debug(`AaveFrxUSDLiquidator address: ${address}`);
    return address;
  }

  async #deployUnwinder(flTaker: Address): Promise<Address> {
    const { address, hash } = await this.deployer.ensureExists({
      abi: aaveFrxUsdUnwinderAbi,
      bytecode: AaveFrxUSDUnwinder_bytecode,
      // constructor(address _owner, address _aavePool, address _aaveFLTaker)
      args: [this.owner, this.#aavePool, flTaker],
    });
    this.report.recordContract({
      name: this.name,
      address,
      deployed: !!hash,
    });
    this.logger.debug(`AaveFrxUSDUnwinder address: ${address}`);
    return address;
  }
}
