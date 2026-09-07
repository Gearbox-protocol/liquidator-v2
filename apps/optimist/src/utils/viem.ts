import { chains, type NetworkType } from "@gearbox-protocol/sdk/onchain";
import type { Chain } from "viem";
import { createPublicClient, defineChain, http } from "viem";

import { waitForChainId } from "./rpc";

/**
 * Returns viem chain that works with testnets
 * @param url
 * @returns
 */
export async function getChain(
  url: string,
  networkType: NetworkType,
): Promise<Chain> {
  const tempClient = createPublicClient({
    transport: http(url, { timeout: 500, retryCount: 1 }),
    cacheTime: 0,
  });
  const chainId = await waitForChainId(tempClient);
  // need to explicitly set chain id on testnets, as it can be overridden
  return defineChain({
    ...chains[networkType],
    id: chainId,
  });
}
