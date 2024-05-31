import { Token } from "typedi";

import { getProvider } from "../utils";
import { detectNetwork } from "../utils/ethers-6-temp";
import { envConfig } from "./env";
import type { Config } from "./schema";
import { ConfigSchema } from "./schema";

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

export type { Config } from "./schema";
