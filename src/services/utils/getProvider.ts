import {
  RetryProvider,
  RotateProvider,
} from "@gearbox-protocol/devops/lib/providers";
import { providers } from "ethers";

import config from "../../config";
import type { LoggerInterface } from "../../log";

export function getProvider(flashbots = false, logger?: LoggerInterface) {
  if (config.optimisticLiquidations) {
    return new providers.StaticJsonRpcProvider({
      url: config.ethProviderRpcs[0],
      timeout: 120_000,
      allowGzip: true,
    });
  }
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
