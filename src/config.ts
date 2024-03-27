import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsUrl,
  Min,
  validate,
} from "class-validator";
import dotenv from "dotenv";

const SUPPORTED_VERSIONS: number[] = [2, 3];

export class Config {
  static version: string;

  @IsNotEmpty()
  static appName: string;

  static port: number;

  static addressProviderOverride?: string;

  @IsNotEmpty()
  static ethProviderRpcs: string[];
  static flashbotsRpc?: string;

  /**
   * JSONRPC calls timeout
   * With freshly started fork first requests often fail with default ethers.js timeout of 120 seconds.
   * In this case, increase this timeout
   */
  static ethProviderTimeout: number | undefined;

  @IsNotEmpty()
  static privateKey: string;

  @IsNotEmpty()
  @Min(0.05)
  static slippage: number;

  @IsNotEmpty()
  static walletPassword: string;

  /**
   * Directory with wallet keys
   */
  static keyPath: string | undefined;
  /**
   * AWS Secrets Manager secret id for wallet keys
   */
  static keySecret: string | undefined;

  static ampqUrl: string | undefined;
  static ampqExchange: string | undefined;
  /**
   * If set, will only work with credit manager(s) with this underlying token symbol (e.g. DAI)
   */
  static underlying: string | undefined;

  /**
   * If set, only these accounts will be optimistically liquidated
   */
  static debugAccounts: string[] | undefined;

  @IsNotEmpty()
  @IsNumber()
  static hfThreshold: number;

  @IsNumber()
  static multicallChunkSize: number;

  @IsNotEmpty()
  static multicallAddress: string;

  @IsNotEmpty()
  @Min(0)
  static skipBlocks: number;

  @IsNotEmpty()
  @Min(1)
  static executorsQty: number;

  @IsNotEmpty()
  @Min(0)
  static balanceToNotify: number;

  /**
   * Which versions (v2/v3) to work with
   * This mode is for parity with go-liquidator, which has 2 different binaries for v2 and v3
   */
  static enabledVersions: Set<number>;

  @IsNotEmpty()
  static optimistic: boolean;

  static partialLiquidatorAddress?: string;

  /**
   * If set, will swap underlying token back to ETH after liquidation using this service (uniswap, 1inch)
   */
  static swapToEth?: string;
  /**
   * 1Inch API Key
   */
  static oneInchApiKey?: string;

  /**
   * Directory to output logs, leave empty if you don't need file output
   */
  static outDir: string | undefined;

  @IsOptional()
  @IsUrl()
  /**
   * Endpoint to send POST-request with output.
   */
  static outEndpoint: string | undefined;
  /**
   * HTTP headers to send with POST request. Serialized as JSON: `{"header1": "value1", "header2": "value2"}`
   */
  static outHeaders: string;

  /**
   * S3 bucket to upload result to
   */
  static outS3Bucket: string | undefined;
  /**
   * s3 path prefix
   */
  static outS3Prefix: string;

  /**
   * Block before any of gearbox contracts was deployed
   * To start querying for gearbox events
   */
  static deployBlock = 13810899;

  /**
   * Output suffix to distinguish outputs of different liquidators
   */
  @IsNotEmpty()
  static outSuffix: string;

  static init() {
    dotenv.config({ path: "./.env.local" });

    Config.version =
      // set in docker build
      process.env.PACKAGE_VERSION ??
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("../package.json").version ??
      "dev";
    Config.appName = process.env.APP_NAME || "Terminator2";
    Config.port = parseInt(process.env.PORT || "4000", 10);
    Config.addressProviderOverride = process.env.ADDRESS_PROVIDER;
    const providers =
      process.env.JSON_RPC_PROVIDERS ?? process.env.JSON_RPC_PROVIDER;
    Config.ethProviderRpcs = providers ? providers.split(",") : [];
    Config.flashbotsRpc = process.env.FLASHBOTS_RPC;
    Config.ethProviderTimeout = process.env.JSON_RPC_TIMEOUT
      ? parseInt(process.env.JSON_RPC_TIMEOUT, 10)
      : undefined;
    Config.privateKey = process.env.PRIVATE_KEY || "";
    Config.slippage = parseFloat(process.env.SLIPPAGE || "0");
    Config.walletPassword = process.env.WALLET_PASSWORD || "";
    Config.hfThreshold = parseInt(process.env.HF_TRESHOLD || "9950", 10);
    Config.ampqUrl = process.env.CLOUDAMQP_URL;
    Config.ampqExchange = process.env.AMPQ_EXCHANGE;
    Config.skipBlocks = parseInt(process.env.SKIP_BLOCKS || "0", 10);
    Config.keyPath = process.env.KEY_PATH;
    Config.keySecret = process.env.KEY_SECRET;
    Config.underlying = process.env.UNDERLYING;
    Config.executorsQty = parseInt(process.env.EXECUTORS_QTY || "3", 10);
    Config.swapToEth = process.env.SWAP_TO_ETH;
    Config.oneInchApiKey = process.env.ONE_INCH_API_KEY;
    Config.multicallChunkSize = parseInt(
      process.env.MULTICALL_CHUNK || "30",
      10,
    );
    Config.multicallAddress =
      process.env.MULTICALL_ADDRESS ||
      "0x5ba1e12693dc8f9c48aad8770482f4739beed696";
    Config.optimistic =
      process.env.OPTIMISTIC_LIQUIDATIONS?.toLowerCase() === "true" ||
      process.env.OPTIMISTIC?.toLowerCase() === "true";
    Config.partialLiquidatorAddress = process.env.PARTIAL_LIQUIDATOR_ADDRESS;
    Config.balanceToNotify = parseFloat(process.env.BALANCE_TO_NOTIFY || "0");
    Config.enabledVersions = new Set(
      process.env.ENABLED_VERSIONS
        ? process.env.ENABLED_VERSIONS.split(",").map(Number)
        : SUPPORTED_VERSIONS,
    );
    Config.debugAccounts = process.env.DEBUG_ACCOUNTS
      ? process.env.DEBUG_ACCOUNTS.toLowerCase().split(",")
      : undefined;

    Config.outDir = process.env.OUT_DIR;
    Config.outEndpoint = process.env.OUT_ENDPOINT;
    Config.outHeaders = process.env.OUT_HEADERS || "{}";
    Config.outSuffix = process.env.OUT_SUFFIX || "ts";
    Config.outS3Bucket = process.env.OUT_S3_BUCKET;
    Config.outS3Prefix = process.env.OUT_S3_PREFIX || "";
  }

  static async validate(): Promise<void> {
    console.log("Loading configuration...");
    Config.init();
    const errors = await validate(Config);
    if (errors.length > 0) {
      throw new Error(`Configuration problems: ${errors.join("\n")}`);
    }
    if (Config.enabledVersions.size === 0) {
      throw new Error("At least one version should be enabled");
    }
    for (const v of Config.enabledVersions) {
      if (!SUPPORTED_VERSIONS.includes(v)) {
        throw new Error(`Unsupported version: ${v}`);
      }
    }
    console.info(`Liquidator TS version: ${Config.version}`);
  }
}

Config.init();

export default Config;
