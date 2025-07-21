import type { NetworkType } from "@gearbox-protocol/sdk";
import { createTransport } from "@gearbox-protocol/sdk/dev";
import { createPublicClient } from "viem";
import type { CommonSchema } from "./common.js";
import type { PartialV300ConfigSchema } from "./partial-liquidator.js";
import type { ConfigSchema } from "./schema.js";

export type Config = ConfigSchema & {
  readonly chainId: number;
  readonly startBlock: bigint;
};

export type LiqduiatorConfig<TSchema extends CommonSchema> = TSchema & {
  readonly chainId: number;
  readonly startBlock: bigint;
};

export async function loadConfig(schema: ConfigSchema): Promise<Config> {
  const client = createPublicClient({
    transport: createTransport({
      rpcProviders: [
        {
          provider: "alchemy",
          keys: schema.alchemyKeys?.map(k => k.value) ?? [],
        },
        { provider: "drpc", keys: schema.drpcKeys?.map(k => k.value) ?? [] },
      ],
      rpcUrls: schema.jsonRpcProviders?.map(k => k.value) ?? [],
      protocol: "http",
      network: schema.network,
    }),
    name: "preload client",
  });

  const [startBlock, chainId] = await Promise.all([
    client.getBlockNumber(),
    client.getChainId(),
  ]);
  return {
    ...partialLiquidatorsV300Defaults(schema.network),
    ...schema,
    startBlock,
    chainId: Number(chainId),
  };
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
          "0x0d398d80007c25ef876617add3abd72e8923cb25",
        ghoPartialLiquidatorAddress:
          "0x7db905514894416e4acf3309d779ef869d7ed4f0",
        dolaPartialLiquidatorAddress:
          "0x38f932ff91f8af058cb37f2be35b094aec538c83",
        nexoPartialLiquidatorAddress:
          "0x5f404db7cf74825772f73e8f5d2d762bd2bd9594",
      };
    }
    case "Sonic": {
      return {
        siloPartialLiquidatorAddress:
          "0x8437432977ace20b4fc27f3317c3a4567909b44f",
      };
    }
    default:
      return {};
  }
}
