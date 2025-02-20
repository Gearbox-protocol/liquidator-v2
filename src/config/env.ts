import type { ConfigSchema } from "./schema.js";

const envConfigMapping: Record<keyof ConfigSchema, string | string[]> = {
  addressProviderOverride: "ADDRESS_PROVIDER",
  marketConfigurators: "MARKET_CONFIGURATORS",
  appName: "APP_NAME",
  batchLiquidatorAddress: "BATCH_LIQUIDATOR_ADDRESS",
  debugAccount: "DEBUG_ACCOUNT",
  debugManager: "DEBUG_MANAGER",
  batchSize: "BATCH_SIZE",
  compressorBatchSize: "COMPRESSOR_BATCH_SIZE",
  castBin: "CAST_BIN",
  deployPartialLiquidatorContracts: "DEPLOY_PARTIAL_LIQUIDATOR",
  deployBatchLiquidatorContracts: "DEPLOY_BATCH_LIQUIDATOR",
  ethProviderRpcs: "JSON_RPC_PROVIDERS",
  hfThreshold: "HF_TRESHOLD",
  restakingWorkaround: "RESTAKING_WORKAROUND",
  redstoneGateways: "REDSTONE_GATEWAYS",
  minBalance: "MIN_BALANCE",
  oneInchApiKey: "ONE_INCH_API_KEY",
  optimistic: "OPTIMISTIC",
  optimisticTimestamp: "OPTIMISTIC_TIMESTAMP",
  outDir: "OUT_DIR",
  outEndpoint: "OUT_ENDPOINT",
  outHeaders: "OUT_HEADERS",
  outFileName: "OUT_FILE_NAME",
  outS3Bucket: "OUT_S3_BUCKET",
  outS3Prefix: "OUT_S3_PREFIX",
  aavePartialLiquidatorAddress: "AAVE_PARTIAL_LIQUIDATOR_ADDRESS",
  ghoPartialLiquidatorAddress: "GHO_PARTIAL_LIQUIDATOR_ADDRESS",
  dolaPartialLiquidatorAddress: "DOLA_PARTIAL_LIQUIDATOR_ADDRESS",
  nexoPartialLiquidatorAddress: "NEXO_PARTIAL_LIQUIDATOR_ADDRESS",
  partialFallback: "PARTIAL_FALLBACK",
  privateKey: "PRIVATE_KEY",
  port: "PORT",
  slippage: "SLIPPAGE",
  swapToEth: "SWAP_TO_ETH",
  telegramBotToken: "TELEGRAM_BOT_TOKEN",
  telegramNotificationsChannel: "TELEGRAM_NOTIFICATIONS_CHANNEL",
  telegramAlersChannel: "TELEGRAM_ALERTS_CHANNEL",
};

export const envConfig: Record<string, string> = Object.fromEntries(
  Object.entries(envConfigMapping)
    .map(([f, k]) => {
      const keys = typeof k === "string" ? [k] : k;
      let value: string | undefined;
      for (const key of keys) {
        value = value ?? process.env[key];
      }
      return [f, value];
    })
    .filter(([_, value]) => value !== undefined && value !== ""),
);
