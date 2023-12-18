import {
  RetryProvider,
  RotateProvider,
} from "@gearbox-protocol/devops/lib/providers";

import config from "../../config";
import type { LoggerInterface } from "../../log";

export function getProvider(flashbots = false, logger?: LoggerInterface) {
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
  if (flashbots && config.flashbotsRpc) {
    rpcs.unshift(
      new RetryProvider({
        url: config.flashbotsRpc,
        timeout: config.ethProviderTimeout,
        allowGzip: true,
      }),
    );
  }

  return rpcs.length > 1
    ? new RotateProvider(rpcs, undefined, logger)
    : rpcs[0];
}
