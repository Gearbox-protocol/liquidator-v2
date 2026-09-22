import type { Config } from "@gearbox-protocol/liquidator-v2-config";
import {
  chains,
  formatBN,
  NATIVE_ADDRESS,
  type OnchainSDK,
} from "@gearbox-protocol/sdk/onchain";
import type { Address } from "viem";
import { formatEther } from "viem";
import { DI } from "../../di.js";
import { type ILogger, Logger } from "../../log/index.js";
import type Client from "../Client.js";

export type CreditManagerRegistration =
  | "registered"
  | "existing"
  | "failed"
  | "unsupported";

export interface DeployedContractEntry {
  /**
   * Entrypoint name, e.g. "Aave Chaos Labs V310" or "SecuritizeLiquidatorHelper"
   */
  name: string;
  address: Address;
  /**
   * False when the contract was already on-chain at startup
   */
  deployed: boolean;
}

export interface CreditManagerEntry {
  /**
   * Credit manager name
   */
  creditManager: string;
  address: Address;
  /**
   * Serving entrypoint name. Absent when no liquidator contract applies.
   */
  contract?: string;
  contractAddress?: Address;
  registration: CreditManagerRegistration;
}

@DI.Injectable(DI.DeployReport)
export class DeployReport {
  @DI.Inject(DI.Client)
  client!: Client;

  @DI.Inject(DI.SDK)
  sdk!: OnchainSDK;

  @DI.Inject(DI.Config)
  config!: Config;

  @Logger("DeployReport")
  logger!: ILogger;

  #contracts: DeployedContractEntry[] = [];
  #creditManagers: CreditManagerEntry[] = [];
  #balanceBefore = 0n;
  #done = false;

  public recordContract(entry: DeployedContractEntry): void {
    if (this.#done) {
      return;
    }
    this.#contracts.push(entry);
  }

  public recordCreditManager(entry: CreditManagerEntry): void {
    if (this.#done) {
      return;
    }
    this.#creditManagers.push(entry);
  }

  public async start(): Promise<void> {
    this.#balanceBefore = await this.client.pub.getBalance({
      address: this.client.address,
    });
  }

  public async finish(): Promise<void> {
    if (this.#done) {
      return;
    }
    this.#done = true;

    const balanceAfter = await this.client.pub.getBalance({
      address: this.client.address,
    });
    const spent =
      this.#balanceBefore > balanceAfter
        ? this.#balanceBefore - balanceAfter
        : 0n;
    const spentUsd = this.#spentUsd(spent);
    const { symbol } = chains[this.config.network].nativeCurrency;
    const log = this.logger.child({ tag: "deploy" });

    const existing = this.#contracts.filter(c => !c.deployed).length;
    const deployed = this.#contracts.filter(c => c.deployed).length;

    log.info(`${existing} liquidator contracts were already deployed`);
    log.info(
      `${deployed} liquidator contracts deployed, spent ${formatEther(spent)} ${symbol} (${formatBN(spentUsd, 8)} USD), balance after: ${formatEther(balanceAfter)} ${symbol}`,
    );

    for (const contract of this.#contracts) {
      log.info(
        contract.deployed
          ? `deployed ${contract.name} at ${contract.address}`
          : `${contract.name} already deployed at ${contract.address}`,
      );
    }

    for (const entry of this.#creditManagers) {
      log.info(this.#creditManagerMessage(entry));
    }
  }

  #spentUsd(spent: bigint): bigint {
    const market = this.sdk.marketRegister.markets[0];
    return (
      market?.priceOracle.safeConvertToUSD(NATIVE_ADDRESS, spent).value ?? 0n
    );
  }

  #creditManagerMessage(entry: CreditManagerEntry): string {
    const where = `${entry.contract} (${entry.contractAddress})`;
    switch (entry.registration) {
      case "registered":
        return `registered ${entry.creditManager} in ${where}`;
      case "existing":
        return `${entry.creditManager} already registered in ${where}`;
      case "failed":
        return `failed to register ${entry.creditManager} in ${where}`;
      case "unsupported":
        return `no partial liquidator contract for ${entry.creditManager}`;
    }
  }
}
