import { securitizeLiquidatorHelperAbi } from "@gearbox-protocol/liquidator-contracts/abi";
import { SecuritizeLiquidatorHelper_bytecode } from "@gearbox-protocol/liquidator-contracts/bytecode";
import type { Config } from "@gearbox-protocol/liquidator-v2-config";
import { Create2Deployer } from "@gearbox-protocol/sdk/dev";
import { SDKConstruct } from "@gearbox-protocol/sdk/onchain";
import type { Account, Address, Chain, Hash, Transport } from "viem";
import { DI } from "../../../di.js";
import { type ILogger, Logger } from "../../../log/index.js";
import type Client from "../../Client.js";
import type { DeployReport } from "../DeployReport.js";

export class RWAContractsDeployer extends SDKConstruct {
  @Logger("RWAContractsDeployer")
  // @ts-expect-error
  logger!: ILogger;

  @DI.Inject(DI.Client)
  liquidatorClient!: Client;

  @DI.Inject(DI.DeployReport)
  report!: DeployReport;

  @DI.Inject(DI.Config)
  config!: Config;

  #deployer?: Create2Deployer<Transport, Chain, Account>;
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
    let address: Address;
    let hash: Hash | undefined;
    try {
      ({ address, hash } = await this.#deployer.ensureExists({
        abi: securitizeLiquidatorHelperAbi,
        bytecode: SecuritizeLiquidatorHelper_bytecode,
        args: [],
      }));
    } catch (e) {
      if (this.config.optimistic) {
        throw e;
      }
      this.report.recordFailure("SecuritizeLiquidatorHelper", e);
      return;
    }
    this.#address = address;
    this.report.recordContract({
      name: "SecuritizeLiquidatorHelper",
      address,
      deployed: !!hash,
    });
    this.logger?.debug(`SecuritizeLiquidatorHelper address: ${address}`);
  }

  public get isDeployed(): boolean {
    return !!this.#address;
  }

  public get address(): Address {
    if (!this.#address) {
      throw new Error("SecuritizeLiquidatorHelper address not set");
    }
    return this.#address;
  }
}
