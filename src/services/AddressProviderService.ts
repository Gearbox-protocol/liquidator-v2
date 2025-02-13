import type { Address, NetworkType } from "@gearbox-protocol/sdk-gov";
import { ADDRESS_PROVIDER } from "@gearbox-protocol/sdk-gov";
import { iAddressProviderV3Abi } from "@gearbox-protocol/types/abi";
import { getContract, hexToString, stringToHex } from "viem";

import type { Config } from "../config/index.js";
import { DI } from "../di.js";
import { type ILogger, Logger } from "../log/index.js";
import { TxParser } from "../utils/ethers-6-temp/txparser/index.js";
import type Client from "./Client.js";

const AP_SERVICES = [
  "PRICE_ORACLE",
  "DATA_COMPRESSOR",
  "ROUTER",
  "PARTIAL_LIQUIDATION_BOT",
  "ACL",
  "DEGEN_DISTRIBUTOR",
] as const;

export type AddressProviderKey = (typeof AP_SERVICES)[number];

const AP_BLOCK_BY_NETWORK: Record<NetworkType, bigint> = {
  Mainnet: 18433056n,
  Arbitrum: 184650310n,
  Optimism: 118410000n,
  Base: 12299805n, // arbitrary block, NOT_DEPLOYED yet
  Sonic: 8897028n, // arbitrary block, NOT_DEPLOYED yet
};

@DI.Injectable(DI.AddressProvider)
export class AddressProviderService {
  @Logger("AddressProvider")
  log!: ILogger;

  @DI.Inject(DI.Config)
  config!: Config;

  @DI.Inject(DI.Client)
  client!: Client;

  #addresses: Map<AddressProviderKey, Map<number, Address>> = new Map();

  public async launch(): Promise<void> {
    const address =
      this.config.addressProviderOverride ??
      ADDRESS_PROVIDER[this.config.network];
    const overrideS = this.config.addressProviderOverride
      ? ` (overrides default ${ADDRESS_PROVIDER[this.config.network]})`
      : "";

    const contract = getContract({
      address,
      abi: iAddressProviderV3Abi,
      client: this.client.pub,
    });

    const logs = await contract.getEvents.SetAddress(
      {
        key: AP_SERVICES.map(s => stringToHex(s, { size: 32 })),
      },
      { fromBlock: AP_BLOCK_BY_NETWORK[this.config.network], strict: true },
    );

    for (const { args } of logs) {
      const { key, version, value } = args;
      const service = hexToString(key!, { size: 32 }) as AddressProviderKey;
      const versions = this.#addresses.get(service) ?? new Map();
      versions.set(Number(version!), value!);
      this.#addresses.set(service, versions);
    }

    // TODO: TxParser is really old and weird class, until we refactor it it's the best place to have this
    TxParser.addAddressProvider(address);

    this.log.info(
      `Launched on ${this.config.network} (${this.config.chainId}) using address provider ${address}${overrideS} with ${logs.length} entries`,
    );
  }

  public findService(
    service: AddressProviderKey,
    minVersion = 0,
    maxVersion_?: number,
  ): Address {
    // defaults to same version for single-digit versions
    // or to same major version for 3-digit versions
    const maxVersion =
      maxVersion_ ??
      (minVersion < 100 ? minVersion : Math.floor(minVersion / 100) * 100 + 99);
    this.log.debug(
      `looking for ${service} in version range [${minVersion}, ${maxVersion}]`,
    );

    const versions = this.#addresses.get(service);
    if (!versions) {
      throw new Error(`cannot find latest ${service}: not entries at all`);
    }
    let version = minVersion;
    let address: Address | undefined;
    for (const [v, addr] of versions.entries()) {
      if (v >= version && v <= maxVersion) {
        version = v;
        address = addr;
      }
    }

    if (!address) {
      throw new Error(`cannot find latest ${service}`);
    }
    this.log.debug(`latest version of ${service}: v${version} at ${address}`);

    return address;
  }
}
