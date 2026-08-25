import { SUPPORTED_NETWORKS } from "@gearbox-protocol/sdk/onchain";
import { z } from "zod/v4";
import { CensoredString } from "./CensoredString.js";
import { CensoredURL } from "./CensoredURL.js";
import { stringArrayLike } from "./schemas/schema-primitives.js";
import { zommandRegistry } from "./Zommand.js";

export const RpcProvider = z.enum([
  "alchemy",
  "drpc",
  "ankr",
  "thirdweb",
  "custom",
  "erpc",
]);
export type RpcProvider = z.infer<typeof RpcProvider>;

export const ProvidersSchema = z.object({
  network: z.enum(SUPPORTED_NETWORKS).register(zommandRegistry, {
    flags: "--network <network>",
    description: "Gearbox-supported network",
    env: "NETWORK",
  }),
  /**
   * RPC providers to use
   */
  jsonRpcProviders: stringArrayLike()
    .pipe(z.array(z.url().transform(CensoredURL.transform)))
    .transform(a => (a.length ? a : undefined))
    .optional()
    .register(zommandRegistry, {
      flags: "--json-rpc-providers <urls...>",
      description: "RPC providers to use, comma separated full http urls.",
      env: "JSON_RPC_PROVIDERS",
    }),
  /**
   * RPC providers to use with their keys
   * Order matters
   */
  enabledProviders: stringArrayLike()
    .pipe(z.array(RpcProvider))
    .optional()
    .register(zommandRegistry, {
      flags: "--enabled-providers <providers...>",
      description:
        "Keyed RPC providers to use, comma separated, order matters. Possible values: custom (for full json rpc urls)/alchemy/drpc/ankr/thirdweb",
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
  /**
   * If set, eRPC will be added as first provider
   */
  erpcProjectId: z.string().optional().register(zommandRegistry, {
    flags: "--erpc-project-id <project-id>",
    description: "If set, eRPC will be added as first provider",
    env: "ERPC_PROJECT_ID",
  }),
  /**
   * eRPC URL to use
   */
  erpcUrl: z.url().default("http://erpc.local").register(zommandRegistry, {
    flags: "--erpc-url <url>",
    description: "eRPC URL to use",
    env: "ERPC_URL",
  }),
  /**
   * Timeout for JSON RPC requests, in milliseconds
   */
  jsonRpcTimeout: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .register(zommandRegistry, {
      flags: "--json-rpc-timeout <timeout>",
      description: "Timeout for JSON RPC requests, in milliseconds",
      env: "JSON_RPC_TIMEOUT",
    }),
});

export type ProvidersSchema = z.infer<typeof ProvidersSchema>;
