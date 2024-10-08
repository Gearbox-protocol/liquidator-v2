import { MAX_INT } from "@gearbox-protocol/sdk-gov";
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
   * By default uses address provider from @gearbox-protocol/sdk-gov
   * Use this option to override address provider
   */
  addressProviderOverride: Address.optional(),
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
   * 65535 is constant for zero-debt account (kind strang, because it's in the middle of the range of allowed values)
   */
  hfThreshold: z.coerce.bigint().min(0n).max(MAX_INT).default(MAX_INT),
  /**
   * Enable optimistic liquidations
   */
  optimistic: booleanLike.pipe(z.boolean().optional()),
  /**
   * The serive can deploy partial liquidator contracts.
   * Usage: deploy them once from local machine then pass the address to production service
   */
  deployAaveLiquidatorContracts: booleanLike.pipe(z.boolean().optional()),
  /**
   * Address of deployed partiali liquidator contract for all credit managers except for GHO-based
   */
  aavePartialLiquidatorAddress: Address.optional(),
  /**
   * The serive can deploy partial liquidator contracts.
   * Usage: deploy them once from local machine then pass the address to production service
   */
  deployGhoLiquidatorContracts: booleanLike.pipe(z.boolean().optional()),
  /**
   * Address of deployed partiali liquidator contract for GHO credit managers
   */
  ghoPartialLiquidatorAddress: Address.optional(),
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
