import type { ConfigSchema } from "./schema";

const envConfigMapping: Record<keyof ConfigSchema, string | string[]> = {
  addressProviderOverride: "ADDRESS_PROVIDER",
  appName: "APP_NAME",
  ampqUrl: "CLOUDAMQP_URL",
  ampqExchange: "AMPQ_EXCHANGE",
  debugAccounts: "DEBUG_ACCOUNTS",
  debugManagers: "DEBUG_MANAGERS",
  balanceToNotify: "BALANCE_TO_NOTIFY",
  deployPartialLiquidatorContracts: "DEPLOY_PARTIAL_LIQUIDATOR",
  ethProviderRpcs: ["JSON_RPC_PROVIDERS", "JSON_RPC_PROVIDER"],
  ethProviderTimeout: "JSON_RPC_TIMEOUT",
  hfThreshold: "HF_TRESHOLD",
  multicallChunkSize: "MULTICALL_CHUNK",
  oneInchApiKey: "ONE_INCH_API_KEY",
  optimistic: ["OPTIMISTIC", "OPTIMISTIC_LIQUIDATIONS"],
  outDir: "OUT_DIR",
  outEndpoint: "OUT_ENDPOINT",
  outHeaders: "OUT_HEADERS",
  outSuffix: "OUT_SUFFIX",
  outS3Bucket: "OUT_S3_BUCKET",
  outS3Prefix: "OUT_S3_PREFIX",
  partialLiquidatorAddress: "PARTIAL_LIQUIDATOR_ADDRESS",
  privateKey: "PRIVATE_KEY",
  skipBlocks: "SKIP_BLOCKS",
  port: "PORT",
  slippage: "SLIPPAGE",
  swapToEth: "SWAP_TO_ETH",
  underlying: "UNDERLYING",
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
