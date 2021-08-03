import { IsNotEmpty, validate } from "class-validator";
import dotenv from "dotenv";

export const WETH_TOKEN = "0xd0a1e359811322d97991e03f863a0c30c2cf029c";
export const SUSHISWAP_ADDRESS = "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506";
export const UNISWAP_V2_ADDRESS = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

export class Config {
  static port: number;

  @IsNotEmpty()
  static ethProviderRpc: string;

  @IsNotEmpty()
  static privateKey: string;

  @IsNotEmpty()
  static botAddress: string

  static init() {
    dotenv.config({path: "./.env.local"})

    Config.port = parseInt(process.env.PORT || "4000");
    Config.ethProviderRpc = process.env.ETH_PROVIDER_KOVAN || "";
    Config.privateKey = process.env.PRIVATE_KEY || "";
    Config.botAddress = process.env.BOT_ADDRESS || "";
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
