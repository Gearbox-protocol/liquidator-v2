import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import { supportedChains, tokenDataByNetwork } from "@gearbox-protocol/sdk-gov";
import { ethers } from "ethers";

const usdcABI = ["function symbol() view returns (string)"];

export const detectNetwork = async (
  provider: ethers.Provider,
): Promise<NetworkType> => {
  for (const chain of supportedChains) {
    const USDCContract = new ethers.Contract(
      tokenDataByNetwork[chain].USDC,
      usdcABI,
      provider,
    );

    try {
      await USDCContract.symbol();
      return chain;
    } catch {}
  }

  throw new Error("Unsupported network");
};
