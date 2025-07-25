import {
  createTransport as createTransportSDK,
  type RpcProvider,
} from "@gearbox-protocol/sdk/dev";
import type { HttpTransportConfig, Transport } from "viem";
import type { CommonSchema } from "../config/common.js";

export function createTransport(
  config: CommonSchema,
  httpConfig?: HttpTransportConfig,
): Transport {
  const { jsonRpcProviders, enabledProviders, alchemyKeys, drpcKeys, network } =
    config;
  return createTransportSDK({
    rpcProviders: [
      {
        provider: "alchemy" as RpcProvider,
        keys: alchemyKeys?.map(k => k.value) ?? [],
      },
      {
        provider: "drpc" as RpcProvider,
        keys: drpcKeys?.map(k => k.value) ?? [],
      },
    ].filter(p => enabledProviders.includes(p.provider)),
    rpcUrls: jsonRpcProviders?.map(k => k.value) ?? [],
    protocol: "http",
    network,
    ...httpConfig,
  });
}
