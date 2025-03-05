import { MAX_UINT16, PERCENTAGE_FACTOR } from "@gearbox-protocol/sdk";
import { Address } from "abitype/zod";
import { type Hex, isHex } from "viem";
import { z } from "zod";

const stringArrayLike = z
  .union([z.string(), z.array(z.string())])
  .transform(v => (typeof v === "string" ? [v] : v));

const booleanLike = z
  .any()
  .transform(v => (typeof v === "string" ? v === "true" : Boolean(v)));

const bigintLike = z.any().transform(v => BigInt(v));

export const ConfigSchema = z.object({
  /**
   * By default uses address provider from @gearbox-protocol/sdk
   * Use this option to override address provider
   */
  addressProviderOverride: Address.optional(),
  /**
   * Market configurators addresses to attach SDK
   */
  marketConfigurators: z
    .string()
    .transform(s => s.split(","))
    .pipe(z.array(Address)),
  /**
   * App name used in various messages to distinguish instances
   */
  appName: z.string().default("liquidator-ts"),
  /**
   * Port to expose some vital signals and metrics
   */
  port: z.coerce.number().default(4000),
  /**
   * Only check this account during local debug session
   */
  debugAccount: Address.optional(),
  /**
   * Only check this credit manager during local debug session
   */
  debugManager: Address.optional(),
  /**
   * Path to foundry/cast binary, so that we can create tree-like traces in case of errors
   * Used during optimistic liquidations
   */
  castBin: z.string().optional(),
  /**
   * RPC providers to use
   */
  ethProviderRpcs: stringArrayLike
    .optional()
    .pipe(z.array(z.string().url()).min(1)),
  /**
   * Private key used to send liquidation transactions
   */
  privateKey: z
    .string()
    .min(1)
    .transform((s): Hex => {
      return isHex(s) ? s : `0x${s}`;
    }),
  /**
   * If balance drops before this value - we should send notification
   */
  minBalance: bigintLike
    .optional()
    .pipe(z.bigint().positive().default(500000000000000000n)),
  /**
   * Filter out all accounts with HF >= threshold during scan stage
   * 65535 is constant for zero-debt account (kinda strange, because it's in the middle of the range of allowed values)
   * TODO: this should be changed to uint256 in contracts
   */
  hfThreshold: z.coerce
    .bigint()
    .min(0n)
    .max(MAX_UINT16)
    .default(PERCENTAGE_FACTOR),
  /**
   * Enable optimistic liquidations
   */
  optimistic: booleanLike.pipe(z.boolean().optional()),
  /**
   * Do not send transactions in non-optimistic mode, just log them
   */
  dryRun: booleanLike.pipe(z.boolean().optional()),
  /**
   * Optimistic timestamp to pass from external runner, in ms
   */
  optimisticTimestamp: z.coerce.number().int().positive().nullish(),
  /**
   * Redstone gateways override
   * Set local caching proxies to avoid rate limiting in test environment
   */
  redstoneGateways: z
    .string()
    .optional()
    .transform(s => (s ? s.split(",") : undefined)),
  /**
   * The serive can deploy partial liquidator contracts.
   * Usage: deploy them once from local machine then pass the address to production service
   */
  deployPartialLiquidatorContracts: booleanLike.pipe(z.boolean().optional()),
  /**
   * Address of deployed partial liquidator contract for all credit managers except for GHO- and DOLA- based
   */
  aavePartialLiquidatorAddress: Address.optional(),
  /**
   * Address of deployed partial liquidator contract for GHO credit managers
   */
  ghoPartialLiquidatorAddress: Address.optional(),
  /**
   * Address of deployed partial liquidator contract for DOLA credit managers
   */
  dolaPartialLiquidatorAddress: Address.optional(),
  /**
   * Address of deployed partial liquidator contract for Nexo credit managers
   */
  nexoPartialLiquidatorAddress: Address.optional(),
  /**
   * Fallback to use full liquidator when partial liquidator fails
   */
  partialFallback: booleanLike.pipe(z.boolean().optional()),
  /**
   * The serive can deploy partial liquidator contracts.
   * Usage: deploy them once from local machine then pass the address to production service
   */
  deployBatchLiquidatorContracts: booleanLike.pipe(z.boolean().optional()),
  /**
   * Address of deployed batch liquidator contract
   */
  batchLiquidatorAddress: Address.optional(),
  /**
   * Number of accounts to liquidate at once using batch liquidator
   */
  batchSize: z.coerce.number().nonnegative().default(10),
  /**
   * Limit number of accounts to load from compressor. 0 = unlimited, let compressor decide
   */
  compressorBatchSize: z.coerce.number().nonnegative().default(0),
  /**
   * Slippage value for pathfined
   */
  slippage: z.coerce.number().min(0).max(10000).int().default(50),
  /**
   * Flag to enable less eager liquidations for LRT tokens
   */
  restakingWorkaround: booleanLike.pipe(z.boolean().optional()),
  /**
   * Use this mechanism to swap underlying token to ETH after the liquidation (abandoned feature)
   */
  swapToEth: z.enum(["1inch", "uniswap"]).optional(),
  /**
   * 1inch api key for swapper
   */
  oneInchApiKey: z.string().optional(),

  /**
   * Directory to save json with optimistic liquidation results
   */
  outDir: z.string().default("."),
  /**
   * REST endpoint to POST json with optimistic liquidation results
   */
  outEndpoint: z.string().url().optional(),
  /**
   * Headers for REST endpoint
   */
  outHeaders: z.string().default("{}"),
  /**
   * s3 bucket to upload json with optimistic liquidation results
   */
  outS3Bucket: z.string().optional(),
  /**
   * s3 bucket path prefix
   */
  outS3Prefix: z.string().default(""),
  /**
   * Filename of json with optimistic liquidation results for s3 or dir output
   */
  outFileName: z.string().optional(),

  /**
   * Telegram bot token used to send notifications
   */
  telegramBotToken: z.string().optional(),
  /**
   * Telegram channel where bot will post critical notifications
   */
  telegramAlersChannel: z.string().startsWith("-").optional(),
  /**
   * Telegram channel where bot will post non-critical notifications
   */
  telegramNotificationsChannel: z.string().startsWith("-").optional(),
});

export type ConfigSchema = z.infer<typeof ConfigSchema>;
