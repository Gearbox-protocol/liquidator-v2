import { Token } from "typedi";

import { detectNetwork } from "../utils/ethers-6-temp/index.js";
import { getProvider } from "../utils/index.js";
import { envConfig } from "./env.js";
import type { Config } from "./schema.js";
import { ConfigSchema } from "./schema.js";

export const CONFIG = new Token("config");

export async function loadConfig(): Promise<Config> {
  const schema = ConfigSchema.parse(envConfig);
  const provider = getProvider(schema);
  const [startBlock, { chainId }, network] = await Promise.all([
    provider.getBlockNumber(),
    provider.getNetwork(),
    detectNetwork(provider),
  ]);
  return {
    ...schema,
    startBlock,
    chainId: Number(chainId),
    network,
  };
}

export type { Config } from "./schema.js";
