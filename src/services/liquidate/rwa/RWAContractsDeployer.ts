import { securitizeLiquidatorHelperAbi } from "@gearbox-protocol/liquidator-contracts/abi";
import { SecuritizeLiquidatorHelper_bytecode } from "@gearbox-protocol/liquidator-contracts/bytecode";
import { SDKConstruct } from "@gearbox-protocol/sdk";
import { Create2Deployer } from "@gearbox-protocol/sdk/dev";
import type { Address, Chain, PrivateKeyAccount, Transport } from "viem";
import { DI } from "../../../di.js";
import { type ILogger, Logger } from "../../../log/index.js";
import type Client from "../../Client.js";

export class RWAContractsDeployer extends SDKConstruct {
  @Logger("RWAContractsDeployer")
  // @ts-expect-error
  logger!: ILogger;

  @DI.Inject(DI.Client)
  liquidatorClient!: Client;

  #deployer?: Create2Deployer<Transport, Chain, PrivateKeyAccount>;
  #address?: Address;

  public async syncState(): Promise<void> {
    if (this.#address) {
      return;
    }
    if (!this.#deployer) {
      this.#deployer = new Create2Deployer(
        this.sdk,
        this.liquidatorClient.wallet,
      );
    }
    const { address } = await this.#deployer.ensureExists({
      abi: securitizeLiquidatorHelperAbi,
      bytecode: SecuritizeLiquidatorHelper_bytecode,
      args: [],
    });
    this.#address = address;
    this.logger?.info(`SecuritizeLiquidatorHelper address: ${address}`);
  }

  public get address(): Address {
    if (!this.#address) {
      throw new Error("SecuritizeLiquidatorHelper address not set");
    }
    return this.#address;
  }
}
