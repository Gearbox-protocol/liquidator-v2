import {
  IsEthereumAddress,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsUrl,
  Min,
  validate,
} from "class-validator";
import dotenv, { config } from "dotenv";

export class Config {
  @IsNotEmpty()
  static appName: string;

  static port: number;

  @IsNotEmpty()
  @IsEthereumAddress()
  static addressProvider: string;

  @IsNotEmpty()
  static ethProviderRpc: string;

  @IsNotEmpty()
  static privateKey: string;

  @IsNotEmpty()
  @Min(0.05)
  static slippage: number;

  @IsNotEmpty()
  static walletPassword: string;

  @IsNotEmpty()
  static keyPath: string;

  static ampqUrl: string | undefined;
  static ampqExchange: string | undefined;

  @IsNotEmpty()
  @IsNumber()
  static hfThreshold: number;

  @IsNotEmpty()
  @Min(0)
  static skipBlocks: number;

  @IsNotEmpty()
  @Min(1)
  static executorsQty: number;

  @IsNotEmpty()
  @Min(0)
  static balanceToNotify: number;

  @IsNotEmpty()
  static optimisticLiquidations: boolean;

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

  static init() {
    dotenv.config({ path: "./.env.local" });

    Config.appName = process.env.APP_NAME || "Terminator2";
    Config.port = parseInt(process.env.PORT || "4000", 10);
    Config.addressProvider = process.env.ADDRESS_PROVIDER || "";
    Config.ethProviderRpc = process.env.JSON_RPC_PROVIDER || "";
    Config.privateKey = process.env.PRIVATE_KEY || "";
    Config.slippage = parseFloat(process.env.SLIPPAGE || "0");
    Config.walletPassword = process.env.WALLET_PASSWORD || "";
    Config.hfThreshold = parseInt(process.env.HF_TRESHOLD || "9950", 10);
    Config.ampqUrl = process.env.CLOUDAMQP_URL;
    Config.ampqExchange = process.env.AMPQ_EXCHANGE;
    Config.skipBlocks = parseInt(process.env.SKIP_BLOCKS || "0", 10);
    Config.keyPath = process.env.KEY_PATH || "keys/";
    Config.executorsQty = parseInt(process.env.EXECUTORS_QTY || "3", 10);
    Config.optimisticLiquidations =
      process.env.OPTIMISTIC_LIQUIDATIONS?.toLowerCase() === "true";
    Config.balanceToNotify = parseFloat(process.env.BALANCE_TO_NOTIFY || "0");
    Config.outDir = process.env.OUT_DIR;
    Config.outEndpoint = process.env.OUT_ENDPOINT;
    Config.outHeaders = process.env.OUT_HEADERS || "{}";
  }

  static async validate(): Promise<void> {
    console.log("Loading configuration...");
    Config.init();
    const errors = await validate(Config);
    if (errors.length > 0)
      throw new Error(`Configuration problems: ${errors.join("\n")}`);
  }
}

Config.init();

export default Config;
