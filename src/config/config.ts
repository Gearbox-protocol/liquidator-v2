import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import { createPublicClient, http } from "viem";

import { createClassFromType, detectNetwork } from "../utils/index.js";
import { envConfig } from "./env.js";
import { ConfigSchema } from "./schema.js";

interface DynamicConfig {
  readonly network: NetworkType;
  readonly chainId: number;
  readonly startBlock: bigint;
}

const ConfigClass = createClassFromType<ConfigSchema & DynamicConfig>();

export class Config extends ConfigClass {
  static async load(): Promise<Config> {
    const schema = ConfigSchema.parse(envConfig);

    const client = createPublicClient({
      transport: http(schema.ethProviderRpcs[0]),
      name: "detect network client",
    });

    const [startBlock, chainId, network] = await Promise.all([
      client.getBlockNumber(),
      client.getChainId(),
      detectNetwork(client),
    ]);
    return new Config({
      ...schema,
      startBlock,
      chainId: Number(chainId),
      network,
    });
  }

  public get isPartial(): boolean {
    return !!(
      this.aavePartialLiquidatorAddress ||
      this.ghoPartialLiquidatorAddress ||
      this.dolaPartialLiquidatorAddress ||
      this.siloPartialLiquidatorAddress ||
      this.deployPartialLiquidatorContracts
    );
  }

  public get isBatch(): boolean {
    return !!(
      this.deployBatchLiquidatorContracts || this.batchLiquidatorAddress
    );
  }
}
