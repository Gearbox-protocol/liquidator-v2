import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import { createPublicClient, http } from "viem";

import { createClassFromType, detectNetwork } from "../utils/index.js";
import { envConfig } from "./env.js";
import { ConfigSchema } from "./schema.js";

// These limits work for DRPC and Alchemy
const PAGE_SIZE: Record<NetworkType, bigint> = {
  Mainnet: 100_000n,
  Optimism: 500_000n,
  Arbitrum: 500_000n,
  Base: 500_000n,
  Sonic: 500_000n,
};

interface DynamicConfig {
  readonly network: NetworkType;
  readonly chainId: number;
  readonly startBlock: bigint;
  readonly logsPageSize: bigint;
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
      logsPageSize: schema.logsPageSize || PAGE_SIZE[network],
    });
  }

  public get isPartial(): boolean {
    return this.liquidationMode === "partial";
  }

  public get isBatch(): boolean {
    return this.liquidationMode === "batch";
  }
}
