import type { NetworkType } from "@gearbox-protocol/sdk-gov";
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
  addressProviderOverride: Address.optional(),

  appName: z.string().default("liquidator-ts"),
  port: z.coerce.number().default(4000),

  debugAccounts: stringArrayLike.optional().pipe(z.array(Address).optional()),
  debugManagers: stringArrayLike.optional().pipe(z.array(Address).optional()),
  /**
   * Path to foundry/cast binary, so that we can create tree-like traces in case of errors
   */
  castBin: z.string().optional(),

  ethProviderRpcs: stringArrayLike
    .optional()
    .pipe(z.array(z.string().url()).min(1)),

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
   * 65535 is constant for zero-debt account
   */
  hfThreshold: z.coerce.number().min(0).max(65536).int().default(65536),
  optimistic: booleanLike.pipe(z.boolean().optional()),
  deployPartialLiquidatorContracts: booleanLike.pipe(z.boolean().optional()),
  partialLiquidatorAddress: Address.optional(),
  deployBatchLiquidatorContracts: booleanLike.pipe(z.boolean().optional()),
  batchSize: z.coerce.number().nonnegative().default(10),
  batchLiquidatorAddress: Address.optional(),
  slippage: z.coerce.number().min(0).max(10000).int().default(50),
  restakingWorkaround: booleanLike.pipe(z.boolean().optional()),

  swapToEth: z.enum(["1inch", "uniswap"]).optional(),
  oneInchApiKey: z.string().optional(),

  outDir: z.string().default("."),
  outEndpoint: z.string().url().optional(),
  outHeaders: z.string().default("{}"),
  outS3Bucket: z.string().optional(),
  outS3Prefix: z.string().default(""),
  outFileName: z.string().optional(),

  telegramBotToken: z.string().optional(),
  telegramAlersChannel: z.string().startsWith("-").optional(),
  telegramNotificationsChannel: z.string().startsWith("-").optional(),
});

export type ConfigSchema = z.infer<typeof ConfigSchema>;

/**
 * Config + derived fields
 */
export type Config = ConfigSchema & {
  network: NetworkType;
  chainId: number;
  startBlock: bigint;
};
