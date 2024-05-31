import type { Provider } from "ethers";
import { FallbackProvider, JsonRpcProvider } from "ethers";
import { Token } from "typedi";

export const PROVIDER = new Token("provider");

export function getProvider(config: { ethProviderRpcs: string[] }): Provider {
  const rpcs = config.ethProviderRpcs.map(
    url =>
      new JsonRpcProvider(url, undefined, {
        staticNetwork: true,
        cacheTimeout: -1,
        batchMaxCount: 1,
      }),
  );

  return rpcs.length > 1
    ? new FallbackProvider(
        rpcs.map((provider, priority) => ({ provider, priority })),
        undefined,
        {
          cacheTimeout: -1,
          eventQuorum: 1,
          quorum: 1,
        },
      )
    : rpcs[0];
}
