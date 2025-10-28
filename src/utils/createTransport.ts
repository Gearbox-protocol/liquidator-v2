import type { ILogger } from "@gearbox-protocol/sdk";
import {
  type ProviderConfig,
  RevolverTransport,
} from "@gearbox-protocol/sdk/dev";
import type { Transport } from "viem";
import type { CommonSchema } from "../config/common.js";
import {
  type INotifier,
  ProviderRotationErrorMessage,
  ProviderRotationSuccessMessage,
} from "../services/notifier/index.js";

export function createTransport(
  config: CommonSchema,
  logger: ILogger,
  notifier: INotifier,
): Transport {
  const {
    jsonRpcProviders,
    enabledProviders,
    alchemyKeys,
    drpcKeys,
    ankrKeys,
    thirdwebKeys,
    network,
  } = config;

  const providers: ProviderConfig[] = [];
  for (const p of enabledProviders) {
    switch (p) {
      case "alchemy":
        if (alchemyKeys) {
          providers.push({
            provider: "alchemy",
            keys: alchemyKeys.map(k => k.value) ?? [],
          });
        }
        break;
      case "drpc":
        if (drpcKeys) {
          providers.push({
            provider: "drpc",
            keys: drpcKeys.map(k => k.value) ?? [],
          });
        }
        break;
      case "ankr":
        if (ankrKeys) {
          providers.push({
            provider: "ankr",
            keys: ankrKeys.map(k => k.value) ?? [],
          });
        }
        break;
      case "thirdweb":
        if (thirdwebKeys) {
          providers.push({
            provider: "thirdweb",
            keys: thirdwebKeys.map(k => k.value) ?? [],
          });
        }
        break;
      case "custom":
        if (jsonRpcProviders) {
          providers.push({
            provider: "custom",
            keys: jsonRpcProviders.map(p => p.value) ?? [],
          });
        }
        break;
    }
  }
  return RevolverTransport.create({
    providers,
    network,
    timeout: config.optimistic ? 240_000 : 10_000,
    retryCount: config.optimistic ? 3 : undefined,
    logger: logger?.child?.({ name: "transport" }),
    onRotateSuccess: (oldT, newT, reason) => {
      notifier.notify(new ProviderRotationSuccessMessage(oldT, newT, reason));
    },
    onRotateFailed: (oldT, reason) => {
      notifier.alert(new ProviderRotationErrorMessage(oldT, reason));
    },
  });
}
