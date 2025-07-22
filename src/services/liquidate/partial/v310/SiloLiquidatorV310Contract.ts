import {
  siloFlTakerAbi,
  siloLiquidatorAbi,
  siloUnwinderAbi,
} from "@gearbox-protocol/next-contracts/abi";
import {
  SiloFLTaker_bytecode,
  SiloLiquidator_bytecode,
  SiloUnwinder_bytecode,
} from "@gearbox-protocol/next-contracts/bytecode";
import { type CreditSuite, type Curator, hexEq } from "@gearbox-protocol/sdk";
import type { Address } from "viem";

import { SONIC_USDCE_SILO, SONIC_WS_SILO } from "../constants.js";
import PartialLiquidatorV310Contract from "./PartialLiquidatorV310Contract.js";

export class SiloLiquidatorV310Contract extends PartialLiquidatorV310Contract {
  #siloFLTaker: Address | undefined;

  public static tryAttach(
    cm: CreditSuite,
  ): SiloLiquidatorV310Contract | undefined {
    if (cm.router.version < 310 || cm.router.version > 319) {
      return undefined;
    }
    if (cm.provider.networkType !== "Sonic") {
      return undefined;
    }
    const curator = cm.name.includes("K3") ? "K3" : "Chaos Labs";
    return new SiloLiquidatorV310Contract(cm.router.address, curator);
  }

  constructor(router: Address, curator: Curator) {
    super("Silo", router, curator);
  }

  public async deploy(): Promise<void> {
    const { address: siloFLTakerAddr } = await this.deployer.ensureExists({
      abi: siloFlTakerAbi,
      bytecode: SiloFLTaker_bytecode,
      // constructor(address _owner)
      args: [this.owner],
    });
    this.logger.debug(`fl taker address: ${siloFLTakerAddr}`);
    this.#siloFLTaker = siloFLTakerAddr;

    const liquidatorAddr =
      this.config.liquidationMode === "deleverage"
        ? await this.#deployUnwinder()
        : await this.#deployLiquidator();

    // siloFLTaker.setTokenToSilo(tokenTestSuite.addressOf(TOKEN_USDC_e), SONIC_USDCE_SILO);
    // siloFLTaker.setTokenToSilo(tokenTestSuite.addressOf(TOKEN_wS), SONIC_WS_SILO);

    const isAllowed = await this.client.pub.readContract({
      address: this.siloFLTaker,
      abi: siloFlTakerAbi,
      functionName: "allowedFLReceiver",
      args: [liquidatorAddr],
    });
    this.logger.debug(`checked allowedFLReceiver: ${isAllowed}`);

    if (!isAllowed) {
      const receipt = await this.client.simulateAndWrite({
        address: this.siloFLTaker,
        abi: siloFlTakerAbi,
        functionName: "setAllowedFLReceiver",
        args: [liquidatorAddr, true],
      });
      if (receipt.status === "reverted") {
        throw new Error(
          `SiloFLTaker.setAllowedFLReceiver reverted, tx hash: ${receipt.transactionHash}`,
        );
      }
      this.logger.debug(
        `set allowed flashloan receiver on SiloFLTaker ${this.siloFLTaker} to ${liquidatorAddr} in tx ${receipt.transactionHash}`,
      );
    }

    await this.#setTokenToSilo("USDC.e", SONIC_USDCE_SILO);
    await this.#setTokenToSilo("wS", SONIC_WS_SILO);
    this.address = liquidatorAddr;
  }

  async #setTokenToSilo(symbol: string, silo: Address): Promise<void> {
    const token = this.sdk.tokensMeta.mustFindBySymbol(symbol).addr;

    const currentSilo = await this.client.pub.readContract({
      address: this.siloFLTaker,
      abi: siloFlTakerAbi,
      functionName: "tokenToSilo",
      args: [token],
    });
    this.logger.debug(`current silo for ${token} (${symbol}): ${currentSilo}`);

    if (!hexEq(currentSilo, silo)) {
      const receipt = await this.client.simulateAndWrite({
        address: this.siloFLTaker,
        abi: siloFlTakerAbi,
        functionName: "setTokenToSilo",
        args: [token, silo],
      });
      if (receipt.status === "reverted") {
        throw new Error(
          `SiloFLTaker.setTokenToSilo(${token}, ${silo}) reverted, tx hash: ${receipt.transactionHash}`,
        );
      }
      this.logger.debug(
        `set token ${token} to silo ${silo} on SiloFLTaker ${this.siloFLTaker} in tx ${receipt.transactionHash}`,
      );
    }
  }

  private get siloFLTaker(): Address {
    if (!this.#siloFLTaker) {
      throw new Error("SiloFLTaker is not deployed");
    }
    return this.#siloFLTaker;
  }

  async #deployLiquidator(): Promise<Address> {
    const { address } = await this.deployer.ensureExists({
      abi: siloLiquidatorAbi,
      bytecode: SiloLiquidator_bytecode,
      // constructor(address _owner, address _siloFLTaker)
      args: [this.owner, this.siloFLTaker],
    });
    this.logger.debug(`SiloLiquidator address: ${address}`);
    return address;
  }

  async #deployUnwinder(): Promise<Address> {
    const { address } = await this.deployer.ensureExists({
      abi: siloUnwinderAbi,
      bytecode: SiloUnwinder_bytecode,
      // constructor(address _owner, address _plb, address _siloFLTaker)
      args: [this.owner, this.partialLiquidationBot, this.siloFLTaker],
    });
    this.logger.debug(`SiloUnwinder address: ${address}`);
    return address;
  }
}
