import type { ConfigSchema } from "./schema.js";

const envConfigMapping: Record<keyof ConfigSchema, string | string[]> = {
  addressProviderOverride: "ADDRESS_PROVIDER",
  appName: "APP_NAME",
  batchLiquidatorAddress: "BATCH_LIQUIDATOR_ADDRESS",
  debugAccounts: "DEBUG_ACCOUNTS",
  debugManagers: "DEBUG_MANAGERS",
  castBin: "CAST_BIN",
  deployPartialLiquidatorContracts: "DEPLOY_PARTIAL_LIQUIDATOR",
  deployBatchLiquidatorContracts: "DEPLOY_BATCH_LIQUIDATOR",
  ethProviderRpcs: ["JSON_RPC_PROVIDERS", "JSON_RPC_PROVIDER"],
  hfThreshold: "HF_TRESHOLD",
  restakingWorkaround: "RESTAKING_WORKAROUND",
  minBalance: "MIN_BALANCE",
  oneInchApiKey: "ONE_INCH_API_KEY",
  optimistic: ["OPTIMISTIC", "OPTIMISTIC_LIQUIDATIONS"],
  outDir: "OUT_DIR",
  outEndpoint: "OUT_ENDPOINT",
  outHeaders: "OUT_HEADERS",
  outFileName: "OUT_FILE_NAME",
  outS3Bucket: "OUT_S3_BUCKET",
  outS3Prefix: "OUT_S3_PREFIX",
  partialLiquidatorAddress: "PARTIAL_LIQUIDATOR_ADDRESS",
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
