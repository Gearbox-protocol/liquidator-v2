import {
  RetryProvider,
  RotateProvider,
} from "@gearbox-protocol/devops/lib/providers";
import type { providers } from "ethers";

import config from "../../config";
import type { LoggerInterface } from "../../log";

export function getProvider(logger?: LoggerInterface): providers.Provider {
  const rpcs = config.ethProviderRpcs.map(
    url =>
      new RetryProvider(
        {
          url,
          timeout: config.ethProviderTimeout,
          allowGzip: true,
        },
        { deployBlock: config.deployBlock, filterLogRange: 50_000 },
      ),
  );

  return rpcs.length > 1
    ? new RotateProvider(rpcs, undefined, logger as any)
    : rpcs[0];
}
