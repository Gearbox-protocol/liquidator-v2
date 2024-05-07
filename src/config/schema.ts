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

  ampqExchange: z.string().optional(),
  ampqUrl: z.string().optional(),
  appName: z.string().default("liquidator-ts"),
  balanceToNotify: z.coerce.number().int().positive().optional(),
  port: z.coerce.number().default(4000),

  debugAccounts: stringArrayLike
    .optional()
    .pipe(z.array(z.string().regex(AddressRegExp)).optional()),
  debugManagers: stringArrayLike
    .optional()
    .pipe(z.array(z.string().regex(AddressRegExp)).optional()),

  ethProviderRpcs: stringArrayLike
    .optional()
    .pipe(z.array(z.string().url()).min(1)),
  ethProviderTimeout: z.coerce.number().optional(),

  privateKey: z.string().min(1),
  hfThreshold: z.coerce.number().min(0).max(10000).int().default(9975),
  optimistic: booleanLike.pipe(z.boolean().optional()),
  deployPartialLiquidatorContracts: booleanLike.pipe(z.boolean().optional()),
  partialLiquidatorAddress: z.string().regex(AddressRegExp).optional(),
  slippage: z.coerce.number().min(0).max(10000).int().default(50),
  underlying: z.string().optional(),

  multicallChunkSize: z.coerce.number().int().default(30),
  skipBlocks: z.coerce.number().int().min(0).default(0),

  swapToEth: z.enum(["1inch", "uniswap"]).optional(),
  oneInchApiKey: z.string().optional(),

  outDir: z.string().default("."),
  outEndpoint: z.string().url().optional(),
  outHeaders: z.string().default("{}"),
  outS3Bucket: z.string().optional(),
  outS3Prefix: z.string().default(""),
  outSuffix: z.string().default("ts"),
});

export type ConfigSchema = z.infer<typeof ConfigSchema>;