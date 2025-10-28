import {
  CensoredString,
  CensoredURL,
  stringArrayLike,
  zommandRegistry,
} from "@gearbox-protocol/cli-utils";
import { z } from "zod/v4";

export const ProvidersSchema = z.object({
  /**
   * RPC providers to use
   */
  jsonRpcProviders: stringArrayLike()
    .pipe(z.array(z.url().transform(CensoredURL.transform)))
    .transform(a => (a.length ? a : undefined))
    .optional()
    .register(zommandRegistry, {
      flags: "--json-rpc-providers <urls...>",
      description: "RPC providers to use, comma separated",
      env: "JSON_RPC_PROVIDERS",
    }),
  /**
   * RPC providers to use with their keys
   * Order matters
   */
  enabledProviders: stringArrayLike()
    .pipe(z.array(z.enum(["alchemy", "drpc", "ankr", "thirdweb", "custom"])))
    .default(["custom", "drpc", "alchemy", "ankr", "thirdweb"])
    .register(zommandRegistry, {
      flags: "--enabled-providers <providers...>",
      description: "keyed RPC providers to use, comma separated, order matters",
      env: "ENABLED_PROVIDERS",
    }),
  /**
   * Alchemy API keys to use
   */
  alchemyKeys: stringArrayLike()
    .pipe(z.array(z.string().transform(CensoredString.transform)))
    .transform(a => (a.length ? a : undefined))
    .optional()
    .register(zommandRegistry, {
      flags: "--alchemy-keys <keys...>",
      description: "Alchemy API keys to use, comma separated",
      env: "ALCHEMY_KEYS",
    }),
  /**
   * DRPC API keys to use
   */
  drpcKeys: stringArrayLike()
    .pipe(z.array(z.string().transform(CensoredString.transform)))
    .transform(a => (a.length ? a : undefined))
    .optional()
    .register(zommandRegistry, {
      flags: "--drpc-keys <keys...>",
      description: "DRPC API keys to use, comma separated",
      env: "DRPC_KEYS",
    }),
  /**
   * Ankr API keys to use
   */
  ankrKeys: stringArrayLike()
    .pipe(z.array(z.string().transform(CensoredString.transform)))
    .transform(a => (a.length ? a : undefined))
    .optional()
    .register(zommandRegistry, {
      flags: "--ankr-keys <keys...>",
      description: "Ankr API keys to use, comma separated",
      env: "ANKR_KEYS",
    }),
  /**
   * Thirdweb API keys to use
   */
  thirdwebKeys: stringArrayLike()
    .pipe(z.array(z.string().transform(CensoredString.transform)))
    .transform(a => (a.length ? a : undefined))
    .optional()
    .register(zommandRegistry, {
      flags: "--thirdweb-keys <keys...>",
      description: "Thirdweb API keys to use, comma separated",
      env: "THIRDWEB_KEYS",
    }),
});
