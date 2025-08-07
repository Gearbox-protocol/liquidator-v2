import {
  createTransport as createTransportSDK,
  type ProviderConfig,
} from "@gearbox-protocol/sdk/dev";
import type { HttpTransportConfig, Transport } from "viem";
import type { CommonSchema } from "../config/common.js";

export function createTransport(
  config: CommonSchema,
  httpConfig?: HttpTransportConfig,
): Transport {
  const { jsonRpcProviders, enabledProviders, alchemyKeys, drpcKeys, network } =
    config;

  const rpcProviders: ProviderConfig[] = [];
  for (const p of enabledProviders) {
    switch (p) {
      case "alchemy":
        if (alchemyKeys) {
          rpcProviders.push({
            provider: "alchemy",
            keys: alchemyKeys.map(k => k.value) ?? [],
          });
        }
        break;
      case "drpc":
        if (drpcKeys) {
          rpcProviders.push({
            provider: "drpc",
            keys: drpcKeys.map(k => k.value) ?? [],
          });
        }
        break;
      case "custom":
        if (jsonRpcProviders) {
          rpcProviders.push({
            provider: "custom",
            keys: jsonRpcProviders.map(p => p.value) ?? [],
          });
        }
        break;
    }
  }
  return createTransportSDK({
    rpcProviders,
    protocol: "http",
    network,
    ...httpConfig,
  });
}
