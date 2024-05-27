import { z } from "zod";

const AddressRegExp = /^0x[a-fA-F0-9]{40}$/;

const stringArrayLike = z
  .union([z.string(), z.array(z.string())])
  .transform(v => (typeof v === "string" ? [v] : v));

const booleanLike = z
  .any()
  .transform(v => (typeof v === "string" ? v === "true" : Boolean(v)));

export const ConfigSchema = z.object({
  addressProviderOverride: z.string().optional(),

  appName: z.string().default("liquidator-ts"),
  port: z.coerce.number().default(4000),

  debugAccounts: stringArrayLike
    .optional()
    .pipe(z.array(z.string().regex(AddressRegExp)).optional()),
  debugManagers: stringArrayLike
    .optional()
    .pipe(z.array(z.string().regex(AddressRegExp)).optional()),
  /**
   * Path to foundry/cast binary, so that we can create tree-like traces in case of errors
   */
  castBin: z.string().optional(),

  ethProviderRpcs: stringArrayLike
    .optional()
    .pipe(z.array(z.string().url()).min(1)),

  privateKey: z.string().min(1),
  /**
   * Filter out all accounts with HF >= threshold during scan stage
   * 65535 is constant for zero-debt account
   */
  hfThreshold: z.coerce.number().min(0).max(65536).int().default(65535),
  optimistic: booleanLike.pipe(z.boolean().optional()),
  deployPartialLiquidatorContracts: booleanLike.pipe(z.boolean().optional()),
  partialLiquidatorAddress: z.string().regex(AddressRegExp).optional(),
  slippage: z.coerce.number().min(0).max(10000).int().default(50),
  underlying: z.string().optional(),

  swapToEth: z.enum(["1inch", "uniswap"]).optional(),
  oneInchApiKey: z.string().optional(),

  outDir: z.string().default("."),
  outEndpoint: z.string().url().optional(),
  outHeaders: z.string().default("{}"),
  outS3Bucket: z.string().optional(),
  outS3Prefix: z.string().default(""),
  outSuffix: z.string().default("ts"),

  telegramBotToken: z.string().optional(),
  telegramAlersChannel: z.string().startsWith("-").optional(),
  telegramNotificationsChannel: z.string().startsWith("-").optional(),
});

export type ConfigSchema = z.infer<typeof ConfigSchema>;
