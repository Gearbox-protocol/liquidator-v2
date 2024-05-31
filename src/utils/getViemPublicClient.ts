import Container, { Token } from "typedi";
import { createPublicClient, fallback, http, type PublicClient } from "viem";

import type { ConfigSchema } from "../config";
import { CONFIG } from "../config";

export const VIEM_PUBLIC_CLIENT = new Token("viemPublicClient");

export function getViemPublicClient(): PublicClient {
  const config = Container.get(CONFIG) as ConfigSchema;
  const rpcs = config.ethProviderRpcs.map(url =>
    http(url, { timeout: 120_000 }),
  );

  return createPublicClient({
    cacheTime: 0,
    transport: rpcs.length > 1 ? fallback(rpcs) : rpcs[0],
  });
}
