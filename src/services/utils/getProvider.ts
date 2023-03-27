import {
  RetryProvider,
  RotateProvider,
} from "@gearbox-protocol/devops/lib/providers";

import config from "../../config";
import { LoggerInterface } from "../../decorators/logger";

export function getProvider(flashbots = false, logger?: LoggerInterface) {
  const rpcs = config.ethProviderRpcs.map(
    url =>
      new RetryProvider({
        url,
        timeout: config.ethProviderTimeout,
        allowGzip: true,
      }),
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