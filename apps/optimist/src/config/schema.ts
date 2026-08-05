import {
  addressLike,
  boolLike,
  CensoredString,
  CensoredURL,
  optionalAddressArrayLike,
  zommandRegistry,
} from "@gearbox-protocol/cli-utils";
import { SUPPORTED_NETWORKS } from "@gearbox-protocol/sdk";
import { z } from "zod/v4";

import { LiquidatorConfig } from "./liquidators";
import { LokiConfig } from "./loki";
import { NotificationsConfig } from "./notifications";

export const GithubCredentials = z.object({
  username: z.string().transform(CensoredString.transform),
  password: z.string().transform(CensoredString.transform),
});

export const S3Config = z.object({
  endpoint: z.string().optional(),
  region: z.string().optional(),
  bucket: z.string().min(1),
  prefix: z.string().optional(),
  artifactsDir: z.string().optional(),
  secretKey: z.string().transform(CensoredString.transform).optional(),
  accessKey: z.string().transform(CensoredString.transform).optional(),
  forcePathStyle: z.boolean().optional(),
});

export type GithubCredentials = z.infer<typeof GithubCredentials>;

export const Config = z
  .object({
    executionId: z.string().register(zommandRegistry, {
      flags: "--execution-id <id>",
      description: "Execution ID",
      env: "EXECUTION_ID",
    }),
    network: z.enum(SUPPORTED_NETWORKS).register(zommandRegistry, {
      flags: "--network <network>",
      description: "Gearbox-supported network",
      env: "NETWORK",
    }),
    addressProvider: addressLike().optional().register(zommandRegistry, {
      flags: "--address-provider <address>",
      description:
        "Address provider override, uses default value from SDK otherwise",
      env: "ADDRESS_PROVIDER",
    }),
    /**
     * Market configurators addresses to attach SDK
     */
    marketConfigurators: optionalAddressArrayLike().register(zommandRegistry, {
      flags: "--market-configurators <addresses...>",
      description:
        "Market configurators to use for the process, comma separated. Uses default value from SDK if not specified",
      env: "MARKET_CONFIGURATORS",
    }),
    /**
     * RWA factories addresses to attach SDK
     */
    rwaFactories: optionalAddressArrayLike().register(zommandRegistry, {
      flags: "--rwa-factories <addresses...>",
      description:
        "RWA factories to use for the process, comma separated. Uses default value from SDK if not specified",
      env: "RWA_FACTORIES",
    }),
    /**
     * RPC to get some data to start the process
     * Is used as default fork origin for anvils
     */
    originRPC: z.url().transform(CensoredURL.transform),
    /**
     * Disables anvil fork rate limit by setting --no-rate-limit anvil flag
     * Can be overridden by liquidator config
     */
    disableRateLimit: boolLike().optional().register(zommandRegistry, {
      flags: "--disable-rate-limit",
      description: "Disables anvil fork rate limit",
      env: "DISABLE_RATE_LIMIT",
    }),
    logLevel: z
      .enum(["debug", "info", "warn", "error"])
      .default("info")
      .register(zommandRegistry, {
        flags: "--log-level <level>",
        description: "Log level",
        env: "LOG_LEVEL",
      }),
    loki: LokiConfig,
    /**
     * Github credentials to pull docker images from ghcr.io
     */
    ghcrCredentials: GithubCredentials.optional(),
    anvilImage: z
      .string()
      .optional()
      .default("ghcr.io/foundry-rs/foundry:latest"),
    /**
     * Total timeout in string format
     * Must be compatible with "timeout" cli command
     */
    timeout: z.string().default("1h"),
    /**
     * S3 to upload artifacts to
     */
    s3: S3Config.optional(),
    extraHeaderTag: z.string().optional(),
    disablePermissionNotifications: z.boolean().optional(),
    /**
     * Specific block number for anvil forks
     */
    blockNumber: z.coerce.bigint().nonnegative().optional(),
    /**
     * Relative offset in seconds from current timestamp to start anvil forks
     * Can be used when blockNumber is not set
     */
    timeOffset: z.coerce.number().nonnegative().optional(),
    /**
     * Relative offset in block numbers from current block number to start anvil forks
     * Can be used when blockNumber is not set
     * Takes precedence over timeOffset
     */
    blockOffset: z.coerce.bigint().nonnegative().optional(),
    forcePullLiquidators: z.boolean().default(true),
    /**
     * Whether display output of Credit Managers with 0 accounts
     */
    displayEmpty: z.boolean().default(true),
    /**
     * Mapping of id (e.g. ts_partial) to config
     */
    liquidators: z
      .array(LiquidatorConfig)
      .transform(liqs => Object.fromEntries(liqs.map(l => [l.id, l]))),
    /**
     * Common ENV to pass to all liquidator containers
     */
    env: z.record(z.string(), z.string()).default({}),
    /**
     * Secrets to pass to all liquidator containers - everything here is censored
     * Still passed as ENV to container, the purpose is to censor strings in optimist logs
     */
    secrets: z
      .record(z.string(), z.string().transform(CensoredString.transform))
      .default({}),
    dockerNetwork: z.string().optional().register(zommandRegistry, {
      flags: "--docker-network <network>",
      description: "Docker network to use for the process",
      env: "DOCKER_NETWORK",
    }),
    /**
     * Output dir path inside optimist container
     */
    containerOutDir: z.string().min(1).register(zommandRegistry, {
      flags: "--container-out-dir <dir>",
      description: "Output dir path inside optimist container",
      env: "OUTPUT_DIR",
    }),
    /**
     * Output dir on host machine
     */
    hostOutDir: z.string().min(1).register(zommandRegistry, {
      flags: "--host-out-dir <dir>",
      description: "Output dir path on host machine",
      env: "OUTPUT_DIR_HOST",
    }),
    /**
     * Path to json file with credit account labels inside optimist container
     * Failure to read this file is not fatal
     */
    accountLabelsFile: z.string().optional().register(zommandRegistry, {
      flags: "--account-labels-file <path>",
      description:
        "Path to json array of { creditAccount, label } with credit account labels",
      env: "ACCOUNT_LABELS_FILE",
    }),
    notifications: z.array(NotificationsConfig).default([]),
    /**
     * This is optimist image version
     * This field is not used by optimist itself, but can be read by external executer from optimist config (see anvil-manager)
     */
    version: z.string().optional(),
    /**
     * Anvil-manager API base URL (ends with /api)
     */
    anvilManagerApiURL: z.url().nullish(),
    /**
     * API key to access anvil-manager
     * TODO: this is used for scheduled mode only
     */
    anvilManagerAPIKey: z
      .string()
      .transform(CensoredString.transform)
      .optional(),
    /**
     * URL to send task progress and errors
     * TODO: is not needed for scheduled mode
     */
    taskCallbackURL: z.url().optional().register(zommandRegistry, {
      flags: "--task-callback-url <url>",
      description: "URL to send task progress and errors",
      env: "TASK_CALLBACK_URL",
    }),
    /**
     * Auth token for taskCallbackURL
     * TODO: is not needed for scheduled mode
     */
    taskToken: z
      .string()
      .transform(CensoredString.transform)
      .optional()
      .register(zommandRegistry, {
        flags: "--task-token <token>",
        description: "Auth token for taskCallbackURL",
        env: "TASK_TOKEN",
      }),
    /**
     * Explicitly set gas limit for SDK
     * -1 to disable explicitly setting gas limit in SDK
     */
    gasLimit: z.coerce.bigint().optional().register(zommandRegistry, {
      flags: "--gas-limit <limit>",
      description: "Explicitly set gas limit for SDK",
      env: "GAS_LIMIT",
    }),
  })
  .refine(v => !(!!v.blockNumber && !!v.blockOffset), {
    error: "cannot have both blockNumber and blockOffset",
  });

export type Config = z.infer<typeof Config>;

export const TaskProgress = z.object({
  completed: z.number(),
  total: z.number(),
  details: z.any().optional(),
});

export type TaskProgress = z.infer<typeof TaskProgress>;

export const TaskCallback = z.object({
  error: z.string().optional(),
  progress: TaskProgress.optional(),
});

export type TaskCallback = z.infer<typeof TaskCallback>;
