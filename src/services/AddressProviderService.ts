import type { Address, NetworkType } from "@gearbox-protocol/sdk-gov";
import { ADDRESS_PROVIDER } from "@gearbox-protocol/sdk-gov";
import { iAddressProviderV3Abi } from "@gearbox-protocol/types/abi";
import type { GetContractReturnType, PublicClient } from "viem";
import { getContract, stringToHex } from "viem";

import type { Config } from "../config/index.js";
import { DI } from "../di.js";
import { type ILogger, Logger } from "../log/index.js";
import { TxParser } from "../utils/ethers-6-temp/txparser/index.js";
import type Client from "./Client.js";

type IAddressProviderV3Contract = GetContractReturnType<
  typeof iAddressProviderV3Abi,
  PublicClient
>;

const AP_BLOCK_BY_NETWORK: Record<NetworkType, bigint> = {
  Mainnet: 18433056n,
  Arbitrum: 184650310n,
  Optimism: 118410000n,
  Base: 12299805n, // arbitrary block, NOT_DEPLOYED yet
};

@DI.Injectable(DI.AddressProvider)
export class AddressProviderService {
  @Logger("AddressProvider")
  log!: ILogger;

  @DI.Inject(DI.Config)
  config!: Config;

  @DI.Inject(DI.Client)
  client!: Client;

  #address?: Address;
  #contract?: IAddressProviderV3Contract;

  public async launch(): Promise<void> {
    this.#address =
      this.config.addressProviderOverride ??
      ADDRESS_PROVIDER[this.config.network];
    const overrideS = this.config.addressProviderOverride
      ? ` (overrides default ${ADDRESS_PROVIDER[this.config.network]})`
      : "";

    this.#contract = getContract({
      address: this.#address,
      abi: iAddressProviderV3Abi,
      client: this.client.pub,
    });

    // TODO: TxParser is really old and weird class, until we refactor it it's the best place to have this
    TxParser.addAddressProvider(this.#address);

    this.log.info(
      `Launched on ${this.config.network} (${this.config.chainId}) using address provider ${this.#address}${overrideS}`,
    );
  }

  public async findService(
    service: string,
    minVersion: number,
    maxVersion_?: number,
  ): Promise<Address> {
    // defaults to same version for single-digit versions
    // or to same major version for 3-digit versions
    const maxVersion =
      maxVersion_ ??
      (minVersion < 100 ? minVersion : Math.floor(minVersion / 100) * 100 + 99);
    this.log.debug(
      `looking for ${service} in version range [${minVersion}, ${maxVersion}]`,
    );

    const logs = await this.contract.getEvents.SetAddress(
      {
        key: stringToHex(service, { size: 32 }),
      },
      { fromBlock: AP_BLOCK_BY_NETWORK[this.config.network] },
    );

    let version = minVersion;
    let address: Address | undefined;
    for (const l of logs) {
      const v = Number(l.args.version);
      if (v >= version && v <= maxVersion) {
        version = v;
        address = l.args.value;
      }
    }

    if (!address) {
      throw new Error(`cannot find latest ${service}`);
    }
    this.log.debug(`latest version of ${service}: v${version} at ${address}`);

    return address as Address;
  }

  public get address(): string {
    if (!this.#address) {
      throw new Error("address provider service not launched");
    }
    return this.#address;
  }

  public get contract(): IAddressProviderV3Contract {
    if (!this.#contract) {
      throw new Error("address provider service not launched");
    }
    return this.#contract;
  }
}
