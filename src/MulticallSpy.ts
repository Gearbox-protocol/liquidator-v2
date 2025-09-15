import { join } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  type DetectedCall,
  type EthCallRequest,
  EthCallSpy,
} from "@gearbox-protocol/sdk/dev";
import {
  decodeFunctionResult,
  multicall3Abi,
  parseAbi,
  type RequiredBy,
} from "viem";
import type { Config } from "./config/index.js";
import { DI } from "./di.js";
import type { ILogger } from "./log/index.js";

const multicallTimestampAbi = parseAbi([
  "function getCurrentBlockTimestamp() public view returns (uint256 timestamp)",
  "function getBlockNumber() public view returns (uint256 blockNumber)",
]);

interface SpiedCall extends DetectedCall {
  multicall: {
    blockNumber: string;
    timestamp: string;
  };
}

/**
 * This is temporary solution to diagnose bug where compressor occasionally returns many accounts with HF = 0
 */
@DI.Injectable(DI.MulticallSpy)
export default class MulticallSpy extends EthCallSpy<SpiedCall> {
  #client = new S3Client({});
  #log: ILogger;
  #config: Config;

  constructor() {
    const log = DI.create(DI.Logger, "MulticallSpy");
    const config = DI.get(DI.Config);
    super(
      isGetCreditAccountsMulticall,
      log,
      config.debugScanner && !config.optimistic,
    );
    this.#log = log;
    this.#config = config;
  }

  public async dumpCalls(): Promise<void> {
    if (!this.#config.outS3Bucket) {
      this.#log.error("outS3Bucket is not set");
      return;
    }
    const key = join(
      this.#config.outS3Prefix,
      this.#config.network,
      `getCreditAccounts_${this.detectedBlock}.json`,
    );
    const s3Url = `s3://${this.#config.outS3Bucket}/${key}`;
    try {
      this.#log.debug(`uploading to ${s3Url}`);
      await this.#client.send(
        new PutObjectCommand({
          Bucket: this.#config.outS3Bucket,
          Key: key,
          ContentType: "application/json",
          Body: JSON.stringify(this.detectedCalls),
        }),
      );
      this.#log.debug(`uploaded to ${s3Url}`);
    } catch (e) {
      this.#log.error(e, `failed to upload to ${s3Url}`);
    }
  }

  protected override storeResponse(
    call: RequiredBy<SpiedCall, "response" | "responseHeaders">,
  ): void | Promise<void> {
    super.storeResponse(call);
    const result = call.response.result;
    if (result) {
      try {
        const res = decodeFunctionResult({
          abi: multicall3Abi,
          data: result,
          functionName: "aggregate3",
        });
        const [timestampEnc, blockNumberEnc] = res;
        const timestamp = decodeFunctionResult({
          abi: multicallTimestampAbi,
          data: timestampEnc.returnData,
          functionName: "getCurrentBlockTimestamp",
        });
        const blockNumber = decodeFunctionResult({
          abi: multicallTimestampAbi,
          data: blockNumberEnc.returnData,
          functionName: "getBlockNumber",
        });
        call.multicall = {
          blockNumber: blockNumber.toString(),
          timestamp: timestamp.toString(),
        };
      } catch (e) {
        this.#log.error(`failed to parse multicall response: ${e}`);
      }
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
