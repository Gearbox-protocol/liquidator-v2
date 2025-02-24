import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import { supportedChains, tokenDataByNetwork } from "@gearbox-protocol/sdk-gov";
import { ierc20MetadataAbi } from "@gearbox-protocol/types/abi";
import type { Address, PublicClient } from "viem";

function wellKnownTokenFor(network: NetworkType): Address {
  if (network === "Sonic") {
    return tokenDataByNetwork[network].USDC_e;
  }
  return tokenDataByNetwork[network].USDC;
}

export async function detectNetwork(
  client: PublicClient,
): Promise<NetworkType> {
  for (const chain of supportedChains) {
    try {
      await client.readContract({
        abi: ierc20MetadataAbi,
        address: wellKnownTokenFor(chain),
        functionName: "symbol",
      });
      return chain;
    } catch {}
  }

  throw new Error("Unsupported network");
}
