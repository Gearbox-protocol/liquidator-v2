import { createPublicClient, http } from "viem";

import { detectNetwork } from "../utils/index.js";
import { envConfig } from "./env.js";
import type { Config } from "./schema.js";
import { ConfigSchema } from "./schema.js";

export async function loadConfig(): Promise<Config> {
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
  return {
    ...schema,
    startBlock,
    chainId: Number(chainId),
    network,
  };
}

export type { Config } from "./schema.js";
