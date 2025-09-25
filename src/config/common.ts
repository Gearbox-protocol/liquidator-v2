import {
  addressLike,
  boolLike,
  CensoredString,
  CensoredURL,
  optionalAddressArrayLike,
  stringArrayLike,
  zommandRegistry,
} from "@gearbox-protocol/cli-utils";
import { MAX_UINT256, SUPPORTED_NETWORKS, WAD } from "@gearbox-protocol/sdk";
import { type Hex, isHex } from "viem";
import { z } from "zod/v4";

export const CommonSchema = z.object({
  network: z.enum(SUPPORTED_NETWORKS).register(zommandRegistry, {
    flags: "--network <network>",
    description: "Gearbox-supported network",
    env: "NETWORK",
  }),
  /**
   * By default uses address provider from @gearbox-protocol/sdk
   * Use this option to override address provider
   */
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
   * App name used in various messages to distinguish instances
   */
  appName: z.string().default("liquidator-ts").register(zommandRegistry, {
    flags: "--app-name <name>",
    description: "App name used in various messages to distinguish instances",
    env: "APP_NAME",
  }),
  /**
   * Port to expose some vital signals and metrics
   */
  port: z.coerce.number().default(4000).register(zommandRegistry, {
    flags: "--port <port>",
    description: "Port to expose some vital signals and metrics",
    env: "PORT",
  }),
  /**
   * These accounts will not be liquidated
   */
  ignoreAccounts: optionalAddressArrayLike().register(zommandRegistry, {
    flags: "--ignore-accounts <addresses...>",
    description: "These accounts will not be liquidated",
    env: "IGNORE_ACCOUNTS",
  }),
  /**
   * Only check this account during local debug session
   */
  debugAccount: addressLike().optional().register(zommandRegistry, {
    flags: "--debug-account <address>",
    description: "Only check this account during local debug session",
    env: "DEBUG_ACCOUNT",
  }),
  /**
   * Only check this credit manager during local debug session
   */
  debugManager: addressLike().optional().register(zommandRegistry, {
    flags: "--debug-manager <address>",
    description: "Only check this credit manager during local debug session",
    env: "DEBUG_MANAGER",
  }),
  /**
   * Path to foundry/cast binary, so that we can create tree-like traces in case of errors
   * Used during optimistic liquidations
   */
  castBin: z.string().optional().register(zommandRegistry, {
    flags: "--cast-bin <path>",
    description:
      "Path to foundry/cast binary, so that we can create tree-like traces in case of errors",
    env: "CAST_BIN",
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
      description: "RPC providers to use, comma separated",
      env: "JSON_RPC_PROVIDERS",
    }),
  /**
   * RPC providers to use with their keys
   */
  enabledProviders: stringArrayLike()
    .pipe(z.array(z.enum(["alchemy", "drpc", "custom"])))
    .default(["custom", "alchemy"])
    .register(zommandRegistry, {
      flags: "--enabled-providers <providers...>",
      description: "keyed RPC providers to use, comma separated",
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
   * Stale block threshold in seconds, to notify and try to rotate rpc provider. 0 means no monitoring
   */
  staleBlockThreshold: z.coerce
    .number()
    .nonnegative()
    .default(120)
    .register(zommandRegistry, {
      flags: "--stale-block-threshold <threshold>",
      description:
        "Stale block threshold in seconds, to notify and try to rotate rpc provider. 0 means no monitoring",
      env: "STALE_BLOCK_THRESHOLD",
    }),
  /**
   * Max block range size for eth_getLogs
   */
  logsPageSize: z.coerce
    .bigint()
    .nonnegative()
    .optional()
    .register(zommandRegistry, {
      flags: "--logs-page-size <size>",
      description: "Max block range size for eth_getLogs",
      env: "LOGS_PAGE_SIZE",
    }),
  /**
   * Polling interval in milliseconds, default to what's default in viem
   */
  pollingInterval: z.coerce
    .number()
    .nonnegative()
    .optional()
    .register(zommandRegistry, {
      flags: "--polling-interval <interval>",
      description:
        "Polling interval in milliseconds, default to what's default in viem",
      env: "POLLING_INTERVAL",
    }),
  /**
   * Private key used to send liquidation transactions
   */
  privateKey: z
    .string()
    .min(1)
    .transform((s): Hex => {
      return isHex(s) ? s : `0x${s}`;
    })
    .transform(CensoredString.transform<Hex>)
    .register(zommandRegistry, {
      flags: "--private-key <key>",
      description: "Private key used to send liquidation transactions",
      env: "PRIVATE_KEY",
    }),
  /**
   * If balance drops before this value - we should send notification
   */
  minBalance: z.coerce
    .bigint()
    .positive()
    .default(500000000000000000n)
    .register(zommandRegistry, {
      flags: "--min-balance <balance>",
      description: "Minimum balance to liquidate",
      env: "MIN_BALANCE",
    }),
  /**
   * Filter out all accounts with HF >= threshold during scan stage
   * Min HF is set to crash older versions, which had 10000 as 100%
   */
  hfThreshold: z.coerce
    .bigint()
    .min(1_10_00n)
    .max(MAX_UINT256)
    .default(WAD - 1n) // 100% accounts are healthy, and credit account compressors filters by HF <= threshold
    .register(zommandRegistry, {
      flags: "--hf-threshold <threshold>",
      description:
        "Filter out all accounts with HF >= threshold during scan stage",
      env: "HF_THRESHOLD",
    }),
  /**
   * Default numSplits for router v3.1 contract
   */
  numSplits: z.coerce
    .bigint()
    .positive()
    .default(10n)
    .register(zommandRegistry, {
      flags: "--num-splits <splits>",
      description: "Default numSplits for router v3.1 contract",
      env: "NUM_SPLITS",
    }),
  /**
   * Liquidator mode
   */
  liquidationMode: z
    .enum(["full", "partial", "batch", "deleverage"])
    .optional()
    .register(zommandRegistry, {
      flags: "--liquidation-mode <mode>",
      description: "Liquidator mode (full/partial/batch/deleverage)",
      env: "LIQUIDATION_MODE",
    }),
  /**
   * Enable optimistic liquidations
   */
  optimistic: boolLike().optional().register(zommandRegistry, {
    flags: "--optimistic",
    description: "Enable optimistic liquidations",
    env: "OPTIMISTIC",
  }),
  /**
   * Optimistic timestamp to pass from external runner, in ms
   */
  optimisticTimestamp: z.coerce
    .number()
    .int()
    .positive()
    .nullish()
    .register(zommandRegistry, {
      flags: "--optimistic-timestamp <timestamp>",
      description: "Optimistic timestamp to pass from external runner, in ms",
      env: "OPTIMISTIC_TIMESTAMP",
    }),
  /**
   * Ignore missing feeds (redstone/pyth)
   */
  ignoreMissingFeeds: boolLike().optional().register(zommandRegistry, {
    flags: "--ignore-missing-feeds",
    description: "Ignore missing feeds (redstone/pyth)",
    env: "IGNORE_MISSING_FEEDS",
  }),
  /**
   * Do not send transactions in non-optimistic mode, just log them
   */
  dryRun: boolLike().optional().register(zommandRegistry, {
    flags: "--dry-run",
    description:
      "Do not send transactions in non-optimistic mode, just log them",
    env: "DRY_RUN",
  }),
  /**
   * Redstone gateways override
   * Set local caching proxies to avoid rate limiting in test environment
   */
  redstoneGateways: stringArrayLike()
    .pipe(z.array(z.url()))
    .transform(a => (a.length ? a : undefined))
    .optional()
    .register(zommandRegistry, {
      flags: "--redstone-gateways <urls...>",
      description: "Redstone gateways to use, comma separated",
      env: "REDSTONE_GATEWAYS",
    }),

  /**
   * Limit number of accounts to load from compressor. 0 = unlimited, let compressor decide
   */
  compressorBatchSize: z.coerce
    .number()
    .nonnegative()
    .default(0)
    .register(zommandRegistry, {
      flags: "--compressor-batch-size <size>",
      description:
        "Limit number of accounts to load from compressor. 0 = unlimited, let compressor decide",
      env: "COMPRESSOR_BATCH_SIZE",
    }),
  /**
   * Slippage value for pathfined
   */
  slippage: z.coerce
    .number()
    .min(0)
    .max(10000)
    .int()
    .default(50)
    .register(zommandRegistry, {
      flags: "--slippage <value>",
      description: "Slippage value for pathfinder",
      env: "SLIPPAGE",
    }),
  /**
   * By default, reserve prices are not updated (except for deleverage mode)
   */
  updateReservePrices: boolLike()
    .optional()
    .default(false)
    .register(zommandRegistry, {
      flags: "--update-reserve-prices",
      description: "Update reserve prices",
      env: "UPDATE_RESERVE_PRICES",
    }),
  /**
   * Flag to enable less eager liquidations for LRT tokens
   */
  restakingWorkaround: boolLike().optional().register(zommandRegistry, {
    flags: "--restaking-workaround",
    description: "Flag to enable less eager liquidations for LRT tokens",
    env: "RESTAKING_WORKAROUND",
  }),
  /**
   * Flag to enable less eager liquidations for LRT tokens
   */
  lskEthWorkaround: boolLike().optional().register(zommandRegistry, {
    flags: "--lsk-eth-workaround",
    description: "Flag to enable less eager liquidations for LRT tokens",
    env: "LSKETH_WORKAROUND",
  }),
  /**
   * List of assets to keep on account after liquidation
   */
  keepAssets: optionalAddressArrayLike().register(zommandRegistry, {
    flags: "--keep-assets <assets...>",
    description: "List of assets to keep on account after liquidation",
    env: "KEEP_ASSETS",
  }),
  /**
   * Use this mechanism to swap underlying token to ETH after the liquidation (abandoned feature)
   */
  swapToEth: z.enum(["1inch", "uniswap"]).optional().register(zommandRegistry, {
    flags: "--swap-to-eth <mode>",
    description:
      "Use this mechanism to swap underlying token to ETH after the liquidation (abandoned feature)",
    env: "SWAP_TO_ETH",
  }),
  /**
   * 1inch api key for swapper
   */
  oneInchApiKey: z
    .string()
    .transform(CensoredString.transform)
    .optional()
    .register(zommandRegistry, {
      flags: "--one-inch-api-key <key>",
      description: "1inch API key for swapper",
      env: "ONE_INCH_API_KEY",
    }),

  /**
   * Directory to save json with optimistic liquidation results
   */
  outDir: z.string().default(".").register(zommandRegistry, {
    flags: "--out-dir <dir>",
    description: "Directory to save json with optimistic liquidation results",
    env: "OUT_DIR",
  }),
  /**
   * REST endpoint to POST json with optimistic liquidation results
   */
  outEndpoint: z.url().optional().register(zommandRegistry, {
    flags: "--out-endpoint <url>",
    description:
      "REST endpoint to POST json with optimistic liquidation results",
    env: "OUT_ENDPOINT",
  }),
  /**
   * Headers for REST endpoint
   */
  outHeaders: z
    .string()
    .default("{}")
    .transform(CensoredString.transform)
    .register(zommandRegistry, {
      flags: "--out-headers <headers>",
      description: "Headers for REST endpoint",
      env: "OUT_HEADERS",
    }),
  /**
   * s3 bucket to upload json with optimistic liquidation results
   */
  outS3Bucket: z.string().optional().register(zommandRegistry, {
    flags: "--out-s3-bucket <bucket>",
    description: "S3 bucket to upload json with optimistic liquidation results",
    env: "OUT_S3_BUCKET",
  }),
  /**
   * s3 bucket path prefix
   */
  outS3Prefix: z.string().default("").register(zommandRegistry, {
    flags: "--out-s3-prefix <prefix>",
    description: "S3 bucket path prefix",
    env: "OUT_S3_PREFIX",
  }),
  /**
   * Filename of json with optimistic liquidation results for s3 or dir output
   */
  outFileName: z.string().optional().register(zommandRegistry, {
    flags: "--out-file-name <name>",
    description:
      "Filename of json with optimistic liquidation results for s3 or dir output",
    env: "OUT_FILE_NAME",
  }),

  /**
   * Telegram bot token used to send notifications
   */
  telegramBotToken: z
    .string()
    .transform(CensoredString.transform)
    .optional()
    .register(zommandRegistry, {
      flags: "--telegram-bot-token <token>",
      description: "Telegram bot token used to send notifications",
      env: "TELEGRAM_BOT_TOKEN",
    }),
  /**
   * Telegram channel where bot will post critical notifications
   */
  telegramAlertsChannel: z
    .string()
    .startsWith("-")
    .optional()
    .register(zommandRegistry, {
      flags: "--telegram-alerts-channel <channel>",
      description:
        "Telegram channel where bot will post critical notifications",
      env: "TELEGRAM_ALERTS_CHANNEL",
    }),
  /**
   * Telegram channel where bot will post non-critical notifications
   */
  telegramNotificationsChannel: z
    .string()
    .startsWith("-")
    .optional()
    .register(zommandRegistry, {
      flags: "--telegram-notifications-channel <channel>",
      description:
        "Telegram channel where bot will post non-critical notifications",
      env: "TELEGRAM_NOTIFICATIONS_CHANNEL",
    }),
});

export type CommonSchema = z.infer<typeof CommonSchema>;
