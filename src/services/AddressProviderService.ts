import type { IAddressProviderV3, NetworkType } from "@gearbox-protocol/sdk";
import {
  ADDRESS_PROVIDER,
  detectNetwork,
  IAddressProviderV3__factory,
} from "@gearbox-protocol/sdk";
import { ethers } from "ethers";
import { Service } from "typedi";

import config from "../config";
import { Logger, LoggerInterface } from "../log";
import { getProvider } from "./utils";

@Service()
export class AddressProviderService {
  @Logger("AddressProviderService")
  log: LoggerInterface;

  #startBlock?: number;
  #chainId?: number;
  #network?: NetworkType;
  #address?: string;
  #contract?: IAddressProviderV3;

  public async launch(): Promise<void> {
    const provider = getProvider(false, this.log);
    const [startBlock, { chainId }] = await Promise.all([
      provider.getBlockNumber(),
      provider.getNetwork(),
    ]);
    this.#network = await detectNetwork(provider);
    this.#chainId = chainId;
    this.#startBlock = startBlock;
    this.#address =
      config.addressProviderOverride ?? ADDRESS_PROVIDER[this.#network];
    const overrideS = config.addressProviderOverride
      ? ` (overrides default ${ADDRESS_PROVIDER[this.#network]})`
      : "";

    this.#contract = IAddressProviderV3__factory.connect(
      this.#address,
      provider,
    );

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

    const logs = await this.contract.provider.getLogs(
      this.contract.filters.SetAddress(
        ethers.utils.formatBytes32String(service),
      ),
    );
    let version = minVersion;
    let address = "";
    for (const l of logs) {
      const e = this.contract.interface.parseLog(l);
      const v = e.args.version.toNumber();
      if (v >= version && v <= maxVersion) {
        version = v;
        address = e.args.value;
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
