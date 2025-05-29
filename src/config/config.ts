import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import { createPublicClient, http } from "viem";

import { createClassFromType, detectNetwork } from "../utils/index.js";
import { envConfig } from "./env.js";
import type { PartialV300ConfigSchema } from "./schema.js";
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
      ...partialLiquidatorsV300Defaults(network),
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

/**
 * Returns env variables with addresses of pre-deployed partial liquidator contracts for v3.0
 * Credit managers v3.1 and router v3.1 and their partial liquidator contracts are deployed using create2, so no need to hardcode constants here
 * @param network
 * @param beta
 * @returns
 */
function partialLiquidatorsV300Defaults(
  network: NetworkType,
): PartialV300ConfigSchema {
  switch (network) {
    case "Mainnet": {
      return {
        aavePartialLiquidatorAddress:
          "0x0d394114fe3a40a39690b7951bf536de7e8fbf4b",
        ghoPartialLiquidatorAddress:
          "0x4c7c2b2115c392d98278ca7f2def992a08bb06f0",
        dolaPartialLiquidatorAddress:
          "0xc1f60b2f3d41bb15738dd52906cdc1de96825ef3",
      };
    }
    case "Arbitrum": {
      return {
        aavePartialLiquidatorAddress:
          "0x7268d7017a330816c69d056ec2e64a8d2c954fc0",
      };
    }
    case "Optimism": {
      return {
        aavePartialLiquidatorAddress:
          "0x8437432977ace20b4fc27f3317c3a4567909b44f",
      };
    }
    default:
      return {};
  }
}
