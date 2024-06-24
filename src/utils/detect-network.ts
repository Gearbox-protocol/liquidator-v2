import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import { supportedChains, tokenDataByNetwork } from "@gearbox-protocol/sdk-gov";
import { ierc20MetadataAbi } from "@gearbox-protocol/types/abi";
import type { PublicClient } from "viem";

export async function detectNetwork(
  client: PublicClient,
): Promise<NetworkType> {
  for (const chain of supportedChains) {
    try {
      await client.readContract({
        abi: ierc20MetadataAbi,
        address: tokenDataByNetwork[chain].USDC,
        functionName: "symbol",
      });
      return chain;
    } catch {}
  }

  throw new Error("Unsupported network");
}
