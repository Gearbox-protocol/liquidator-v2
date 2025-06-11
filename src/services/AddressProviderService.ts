import type { Address, NetworkType } from "@gearbox-protocol/sdk-gov";
import { ADDRESS_PROVIDER } from "@gearbox-protocol/sdk-gov";
import { iAddressProviderV3Abi } from "@gearbox-protocol/types/abi";
import { getAbiItem, hexToString, stringToHex } from "viem";

import type { Config } from "../config/index.js";
import { DI } from "../di.js";
import { type ILogger, Logger } from "../log/index.js";
import { TxParser } from "../utils/ethers-6-temp/txparser/index.js";
import { getLogsPaginated } from "../utils/getLogsPaginated.js";
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
  Sonic: 9779379n,
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

    const toBlock = await this.client.pub.getBlockNumber();
    await this.#loadWithMulticall(address, toBlock);

    // TODO: TxParser is really old and weird class, until we refactor it it's the best place to have this
    TxParser.addAddressProvider(address);

    this.log.info(
      `Launched on ${this.config.network} (${this.config.chainId}) using address provider ${address}${overrideS}`,
    );
  }

  // instead of loading events, which many rpc providers limit heavily, load versions 0 and 300-309 via multicall
  async #loadWithMulticall(address: Address, toBlock: bigint): Promise<void> {
    const entries: Array<[AddressProviderKey, bigint]> = [];
    for (const s of AP_SERVICES) {
      entries.push([s, 0n]);
      for (let i = 300n; i <= 309n; i++) {
        entries.push([s, i]);
      }
    }

    const res = await this.client.pub.multicall({
      contracts: entries.map(
        ([s, v]) =>
          ({
            abi: iAddressProviderV3Abi,
            address,
            functionName: "getAddressOrRevert",
            args: [stringToHex(s, { size: 32 }), v],
          }) as const,
      ),
      allowFailure: true,
      blockNumber: toBlock,
    });

    let cnt = 0;
    for (let i = 0; i < res.length; i++) {
      const [service, v] = entries[i];
      const r = res[i];
      if (r.status === "success") {
        const versions = this.#addresses.get(service) ?? new Map();
        versions.set(Number(v!), r.result);
        this.#addresses.set(service, versions);
        cnt++;
      }
    }

    this.log.debug(`found ${cnt} entries`);
  }

  // old way, do not deprecate yet
  // eslint-disable-next-line no-unused-private-class-members
  async #launchFromLogs(address: Address, toBlock: bigint): Promise<void> {
    const logs = await getLogsPaginated(this.client.logs, {
      address,
      event: getAbiItem({ abi: iAddressProviderV3Abi, name: "SetAddress" }),
      args: { key: AP_SERVICES.map(s => stringToHex(s, { size: 32 })) },
      fromBlock: AP_BLOCK_BY_NETWORK[this.config.network],
      toBlock,
      strict: true,
      pageSize: this.config.logsPageSize,
    });

    for (const { args } of logs) {
      const { key, version, value } = args;
      const service = hexToString(key!, { size: 32 }) as AddressProviderKey;
      const versions = this.#addresses.get(service) ?? new Map();
      versions.set(Number(version!), value!);
      this.#addresses.set(service, versions);
    }
    this.log.debug(`found ${logs.length} logs`);
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
