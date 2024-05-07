import type { Provider } from "ethers";
import { FallbackProvider, JsonRpcProvider } from "ethers";
import Container, { Token } from "typedi";

import type { ConfigSchema } from "../config";
import { CONFIG } from "../config";

export const PROVIDER = new Token("config");

export function getProvider(): Provider {
  const config = Container.get(CONFIG) as ConfigSchema;
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
