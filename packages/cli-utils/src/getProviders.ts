import type { ProviderConfig } from "@gearbox-protocol/sdk/dev";
import type { ILogger } from "@gearbox-protocol/sdk/onchain";
import type { PartialBy } from "viem";
import { CensoredURL } from "./CensoredURL.js";
import {
  getAlchemyUrl,
  getAnkrUrl,
  getDrpcUrl,
  getErpcKey,
  getThirdWebUrl,
} from "./providers.js";
import type { ProvidersSchema } from "./providers-schema.js";

export function getProviders(
  config: ProvidersSchema,
  logger?: ILogger,
): ProviderConfig[] {
  const {
    network,

    enabledProviders = [
      "erpc",
      "custom",
      "drpc",
      "alchemy",
      "ankr",
      "thirdweb",
    ],
    alchemyKeys = [],
    ankrKeys = [],
    drpcKeys = [],
    thirdwebKeys = [],
    jsonRpcProviders = [],

    erpcProjectId,
    erpcUrl,
  } = config;
  const result: PartialBy<ProviderConfig, "url">[] = [];
  for (const p of enabledProviders) {
    switch (p) {
      case "alchemy":
        result.push(
          ...alchemyKeys.map(k => ({
            name: "alchemy",
            url: getAlchemyUrl(network, k.value),
          })),
        );
        break;
      case "drpc":
        result.push(
          ...drpcKeys.map(k => ({
            name: "drpc",
            url: getDrpcUrl(network, k.value),
          })),
        );
        break;
      case "ankr":
        result.push(
          ...ankrKeys.map(k => ({
            name: "ankr",
            url: getAnkrUrl(network, k.value),
          })),
        );
        break;
      case "thirdweb":
        result.push(
          ...thirdwebKeys.map(k => ({
            name: "thirdweb",
            url: getThirdWebUrl(network, k.value),
          })),
        );
        break;
      case "custom":
        result.push(
          ...jsonRpcProviders.map((url): ProviderConfig => {
            const urlObj = new URL(url.value);
            const hasCredentials = urlObj.username || urlObj.password;

            let cleanUrl = url.value;
            let httpTransportOptions: ProviderConfig["httpTransportOptions"] =
              {};

            if (hasCredentials) {
              // Create URL without credentials
              const cleanUrlObj = new URL(url.value);
              cleanUrlObj.username = "";
              cleanUrlObj.password = "";
              cleanUrl = cleanUrlObj.toString();

              // Create Basic Auth header
              const credentials = `${urlObj.username}:${urlObj.password}`;
              const encodedCredentials =
                Buffer.from(credentials).toString("base64");

              httpTransportOptions = {
                fetchOptions: {
                  headers: {
                    Authorization: `Basic ${encodedCredentials}`,
                  },
                },
              };
            }

            return {
              name: getTopLevelDomain(urlObj),
              url: cleanUrl,
              httpTransportOptions,
            };
          }),
        );
        break;
      case "erpc":
        if (erpcProjectId && erpcUrl) {
          result.push({
            name: "erpc",
            url: getErpcKey(network, erpcProjectId, erpcUrl),
          });
        }
        break;
    }
  }
  if (logger) {
    const providers = result
      .filter(p => !!p.url)
      .map(p => ({
        name: p.name,
        url: new CensoredURL(p.url!),
      }));
    logger.debug({ providers, network }, "gathered providers");
  }
  return result
    .map(p => ({
      ...p,
      httpClientOptions: {
        ...p.httpTransportOptions,
        methods: { exclude: ["eth_fillTransaction"] },
      },
    }))
    .filter(p => !!p.url) as ProviderConfig[];
}

/**
 * Take the last two parts for top-level domain (e.g., "google.com" from "a.b.c.google.com")
 **/
function getTopLevelDomain({ hostname }: URL): string {
  const parts = hostname.split(".");
  return parts.length >= 2 ? parts.slice(-2).join(".") : hostname;
}
