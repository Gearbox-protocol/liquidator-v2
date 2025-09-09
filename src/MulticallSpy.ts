import { join } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { type EthCallRequest, EthCallSpy } from "@gearbox-protocol/sdk/dev";
import type { Config } from "./config/index.js";
import { DI } from "./di.js";
import { type ILogger, Logger } from "./log/index.js";

/**
 * This is temporary solution to diagnose bug where compressor occasionally returns many accounts with HF = 0
 */
@DI.Injectable(DI.MulticallSpy)
export default class MulticallSpy {
  @Logger("MulticallSpy")
  log!: ILogger;

  @DI.Inject(DI.Config)
  config!: Config;

  public readonly spy: EthCallSpy;
  #client = new S3Client({});

  constructor() {
    this.spy = new EthCallSpy(
      isGetCreditAccountsMulticall,
      this.log,
      this.config.debugScanner && !this.config.optimistic,
    );
  }

  public async dumpCalls(): Promise<void> {
    if (!this.config.outS3Bucket) {
      this.log.error("outS3Bucket is not set");
      return;
    }
    const key = join(
      this.config.outS3Prefix,
      `getCreditAccounts_${this.spy.detectedBlock}.json`,
    );
    const s3Url = `s3://${this.config.outS3Bucket}/${key}`;
    try {
      this.log.debug(`uploading to ${s3Url}`);
      await this.#client.send(
        new PutObjectCommand({
          Bucket: this.config.outS3Bucket,
          Key: key,
          ContentType: "application/json",
          Body: JSON.stringify(this.spy.detectedCalls),
        }),
      );
      this.log.debug(`uploaded to ${s3Url}`);
    } catch (e) {
      this.log.error(e, `failed to upload to ${s3Url}`);
    }
  }
}

/**
 * Detects multicalls to CreditAccounts.getCreditAccounts
 * @param data
 * @returns block number if it's a getCreditAccounts multicall, undefined otherwise
 */
function isGetCreditAccountsMulticall(data: EthCallRequest): boolean {
  try {
    if (
      data.method === "eth_call" &&
      // detect eth_call to multicall3: 0xca11bde05977b3631167028862be2a173976ca11
      data.params[0].to === "0xca11bde05977b3631167028862be2a173976ca11" &&
      // that contain CA compressor: "0x4115708Fc8fe6bB392De2e0C21c2C81dA2222394"
      data.params[0].data?.includes(
        "4115708fc8fe6bb392de2e0c21c2c81da2222394",
      ) &&
      // includes getCreditAccounts signature
      // cast 4byte 0xf43bdb34
      // getCreditAccounts((address[],address[],address[],address),(address,bool,uint256,uint256,bool),uint256)
      // cast 4byte 0x8b59b911
      // getCreditAccounts((address[],address[],address[],address),(address,bool,uint256,uint256,bool),uint256,uint256)
      (data.params[0].data?.includes("f43bdb34") ||
        data.params[0].data?.includes("8b59b911"))
    ) {
      return true;
    }
  } catch {}
  return false;
}
