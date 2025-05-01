import { createTransport } from "@gearbox-protocol/sdk/dev";
import { createPublicClient } from "viem";
import { fromError } from "zod-validation-error";

import { createClassFromType } from "../utils/index.js";
import { envConfig } from "./env.js";
import { ConfigSchema } from "./schema.js";

interface DynamicConfig {
  readonly chainId: number;
  readonly startBlock: bigint;
}

const ConfigClass = createClassFromType<ConfigSchema & DynamicConfig>();

export class Config extends ConfigClass {
  static async load(): Promise<Config> {
    let schema: ConfigSchema;
    try {
      schema = ConfigSchema.parse(envConfig);
    } catch (e) {
      throw fromError(e);
    }

    const client = createPublicClient({
      transport: createTransport({
        alchemyKeys: schema.alchemyKeys ?? [],
        rpcUrls: schema.jsonRpcProviders ?? [],
        protocol: "http",
        network: schema.network,
      }),
      name: "preload client",
    });

    const [startBlock, chainId] = await Promise.all([
      client.getBlockNumber(),
      client.getChainId(),
    ]);
    return new Config({
      ...schema,
      startBlock,
      chainId: Number(chainId),
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
