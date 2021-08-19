import { IsEthereumAddress, IsNotEmpty, Min, validate } from "class-validator";
import dotenv from "dotenv";

export const SUSHISWAP_ADDRESS = "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506";
export const UNISWAP_V2_ADDRESS = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

export class Config {
  static port: number;

  @IsNotEmpty()
  @IsEthereumAddress()
  static addressProvider: string;

  @IsNotEmpty()
  static ethProviderRpc: string;

  @IsNotEmpty()
  static privateKey: string;

  @IsNotEmpty()
  @IsEthereumAddress()
  static botAddress: string;

  @IsNotEmpty()
  @Min(0.05)
  static slippage: number;

  @IsNotEmpty()
  static walletPassword: string;

  @IsNotEmpty()
  static ampqUrl: string;

  @IsNotEmpty()
  @Min(1)
  static skipBlocks: number;

  static init() {
    dotenv.config({ path: "./.env.local" });

    Config.port = parseInt(process.env.PORT || "4000");
    Config.addressProvider = process.env.ADDRESS_PROVIDER || "";
    Config.ethProviderRpc = process.env.JSON_RPC_PROVIDER || "";
    Config.privateKey = process.env.PRIVATE_KEY || "";
    Config.botAddress = process.env.BOT_ADDRESS || "";
    Config.slippage = parseFloat(process.env.SLIPPAGE || "0");
    Config.walletPassword = process.env.WALLET_PASSWORD || "";
    Config.ampqUrl = process.env.CLOUDAMQP_URL || "";
    Config.skipBlocks = parseInt(process.env.SKIP_BLOCKS || "0");
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
