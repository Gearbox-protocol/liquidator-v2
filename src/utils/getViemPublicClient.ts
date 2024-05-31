import { Container, Token } from "typedi";
import { createPublicClient, fallback, http, type PublicClient } from "viem";

import type { Config } from "../config/index.js";
import { CONFIG } from "../config/index.js";

export const VIEM_PUBLIC_CLIENT = new Token("viemPublicClient");

export function getViemPublicClient(): PublicClient {
  const config = Container.get(CONFIG) as Config;
  const rpcs = config.ethProviderRpcs.map(url =>
    http(url, { timeout: 120_000 }),
  );

  return createPublicClient({
    cacheTime: 0,
    transport: rpcs.length > 1 ? fallback(rpcs) : rpcs[0],
  });
}