import { ADDRESS_PROVIDER, type NetworkType } from "@gearbox-protocol/sdk-gov";
import {
  type IAddressProviderV3,
  IAddressProviderV3__factory,
} from "@gearbox-protocol/types/v3";
import { encodeBytes32String, Provider } from "ethers";
import { Inject, Service } from "typedi";

import { CONFIG, type ConfigSchema } from "../config";
import { Logger, type LoggerInterface } from "../log";
import { PROVIDER } from "../utils";
import { detectNetwork } from "../utils/ethers-6-temp";
import { TxParser } from "../utils/ethers-6-temp/txparser";

const AP_BLOCK_BY_NETWORK: Record<NetworkType, number> = {
  Mainnet: 18433056,
  Arbitrum: 184650310,
  Optimism: 117197176, // arbitrary block, NOT_DEPLOYED yet
  Base: 12299805, // arbitrary block, NOT_DEPLOYED yet
};

@Service()
export class AddressProviderService {
  @Logger("AddressProviderService")
  log: LoggerInterface;

  @Inject(PROVIDER)
  provider: Provider;

  @Inject(CONFIG)
  config: ConfigSchema;

  #startBlock?: number;
  #chainId?: number;
  #network?: NetworkType;
  #address?: string;
  #contract?: IAddressProviderV3;

  public async launch(): Promise<void> {
    const [startBlock, { chainId }] = await Promise.all([
      this.provider.getBlockNumber(),
      this.provider.getNetwork(),
    ]);
    this.#network = await detectNetwork(this.provider);
    this.#chainId = Number(chainId);
    this.#startBlock = startBlock;
    this.#address =
      this.config.addressProviderOverride ?? ADDRESS_PROVIDER[this.#network];
    const overrideS = this.config.addressProviderOverride
      ? ` (overrides default ${ADDRESS_PROVIDER[this.#network]})`
      : "";

    this.#contract = IAddressProviderV3__factory.connect(
      this.#address,
      this.provider,
    );

    // TODO: TxParser is really old and weird class, until we refactor it it's the best place to have this
    TxParser.addAddressProvider(this.#address);

    this.log.info(
      `Launched on ${this.#network} (${chainId}) using address provider ${this.#address}${overrideS}`,
    );
  }

  public async findService(
    service: string,
    minVersion: number,
    maxVersion_?: number,
  ): Promise<string> {
    // defaults to same version for single-digit versions
    // or to same major version for 3-digit versions
    const maxVersion =
      maxVersion_ ??
      (minVersion < 100 ? minVersion : Math.floor(minVersion / 100) * 100 + 99);
    this.log.debug(
      `looking for ${service} in version range [${minVersion}, ${maxVersion}]`,
    );

    const logs = await this.contract.queryFilter(
      this.contract.filters.SetAddress(encodeBytes32String(service)),
      AP_BLOCK_BY_NETWORK[this.network],
    );
    let version = minVersion;
    let address = "";
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

    return address;
  }

  public get startBlock(): number {
    if (!this.#startBlock) {
      throw new Error("address provider service not launched");
    }
    return this.#startBlock;
  }

  public get chainId(): number {
    if (!this.#chainId) {
      throw new Error("address provider service not launched");
    }
    return this.#chainId;
  }

  public get network(): NetworkType {
    if (!this.#network) {
      throw new Error("address provider service not launched");
    }
    return this.#network;
  }

  public get address(): string {
    if (!this.#address) {
      throw new Error("address provider service not launched");
    }
    return this.#address;
  }

  public get contract(): IAddressProviderV3 {
    if (!this.#contract) {
      throw new Error("address provider service not launched");
    }
    return this.#contract;
  }
}
