import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import { Container, Token } from "typedi";
import type { Chain, PublicClient } from "viem";
import { createPublicClient, defineChain, fallback, http } from "viem";
import { arbitrum, base, mainnet, optimism } from "viem/chains";

import type { Config } from "../config/index.js";
import { CONFIG } from "../config/index.js";

export const VIEM_PUBLIC_CLIENT = new Token("viemPublicClient");

const CHAINS: Record<NetworkType, Chain> = {
  Mainnet: mainnet,
  Arbitrum: arbitrum,
  Optimism: optimism,
  Base: base,
};

export function getViemPublicClient(): PublicClient {
  const { ethProviderRpcs, chainId, network, optimistic } = Container.get(
    CONFIG,
  ) as Config;
  const rpcs = ethProviderRpcs.map(url => http(url, { timeout: 120_000 }));

  return createPublicClient({
    cacheTime: 0,
    chain: defineChain({
      ...CHAINS[network],
      id: chainId,
    }),
    transport: rpcs.length > 1 ? fallback(rpcs) : rpcs[0],
    pollingInterval: optimistic ? 25 : undefined,
  });
}
