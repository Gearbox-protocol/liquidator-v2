import { join } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type {
  EIP1193Parameters,
  HttpTransportConfig,
  PublicRpcSchema,
} from "viem";
import type { Config } from "./config/index.js";
import { DI } from "./di.js";
import { type ILogger, Logger } from "./log/index.js";

type DetectedCall = EIP1193Parameters<PublicRpcSchema> & {
  headers?: Record<string, string>;
};

/**
 * This is temporary solution to diagnose bug where compressor occasionally returns many accounts with HF = 0
 */
@DI.Injectable(DI.MulticallSpy)
export default class MulticallSpy {
  @Logger("MulticallSpy")
  log!: ILogger;

  @DI.Inject(DI.Config)
  config!: Config;

  #client = new S3Client({});
  #detectedCalls: DetectedCall[] = [];
  #detectedBlock = 0n;

  public multicallRequestSpy: Required<HttpTransportConfig>["onFetchRequest"] =
    async request => {
      if (!this.config.debugScanner || this.config.optimistic) {
        return;
      }
      const data = (await request.json()) as EIP1193Parameters<PublicRpcSchema>;
      const blockNumber = isGetCreditAccountsMulticall(data);
      if (blockNumber) {
        this.#storeCall(blockNumber, data);
        this.log.debug(
          `stored getCreditAccounts multicall at block ${blockNumber}, total calls: ${this.#detectedCalls.length}`,
        );
      }
    };

  public multicallResponseSpy: Required<HttpTransportConfig>["onFetchResponse"] =
    async response => {
      if (!this.config.debugScanner || this.config.optimistic) {
        return;
      }
      const copy = response.clone();
      const resp = await copy.json();
      const id = (resp as any).id as number;
      const call = this.#detectedCalls.find(c => "id" in c && c.id === id);
      if (call) {
        call.headers = Object.fromEntries(response.headers.entries());
      }
    };

  public async dumpCalls(): Promise<void> {
    if (!this.config.debugScanner || this.config.optimistic) {
      return;
    }
    if (!this.config.outS3Bucket) {
      this.log.error("outS3Bucket is not set");
      return;
    }
    const key = join(
      this.config.outS3Prefix,
      `getCreditAccounts_${this.#detectedBlock}.json`,
    );
    const s3Url = `s3://${this.config.outS3Bucket}/${key}`;
    try {
      this.log.debug(`uploading to ${s3Url}`);
      await this.#client.send(
        new PutObjectCommand({
          Bucket: this.config.outS3Bucket,
          Key: key,
          ContentType: "application/json",
          Body: JSON.stringify(this.#detectedCalls),
        }),
      );
    } catch (e) {
      this.log.error(e, `failed to upload to ${s3Url}`);
    }
  }

  #storeCall(
    blockNumber: bigint,
    data: EIP1193Parameters<PublicRpcSchema>,
  ): void {
    if (blockNumber !== this.#detectedBlock) {
      this.#detectedBlock = blockNumber;
      this.#detectedCalls = [];
    }
    this.#detectedCalls.push(data);
  }
}

/**
 * Detects multicalls to CreditAccounts.getCreditAccounts
 * @param data
 * @returns block number if it's a getCreditAccounts multicall, undefined otherwise
 */
function isGetCreditAccountsMulticall(
  data: EIP1193Parameters<PublicRpcSchema>,
): bigint | undefined {
  try {
    if (
      data.method === "eth_call" &&
      // detect eth_call to multicall3: 0xca11bde05977b3631167028862be2a173976ca11
      data.params[0].to === "0xca11bde05977b3631167028862be2a173976ca11" &&
      typeof data.params[1] === "string" &&
      data.params[1]?.startsWith("0x") && // non-latest block
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
      return BigInt(data.params[1]);
    }
  } catch {}
}
