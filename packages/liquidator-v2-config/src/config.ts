import { createPublicClient, type Transport } from "viem";
import type { CommonSchema } from "./common.js";
import type { ConfigSchema } from "./schema.js";

export type Config = ConfigSchema & {
  readonly chainId: number;
  readonly startBlock: bigint;
};

export type LiqduiatorConfig<TSchema extends CommonSchema> = TSchema & {
  readonly chainId: number;
  readonly startBlock: bigint;
};

export class ConfigImplementation {
  #startBlock?: bigint;
  #chainId?: number;

  constructor(schema: ConfigSchema) {
    Object.assign(this, schema);
  }

  public async initialize(transport: Transport): Promise<void> {
    const client = createPublicClient({
      transport,
      name: "preload client",
    });

    const [startBlock, chainId] = await Promise.all([
      client.getBlockNumber(),
      client.getChainId(),
    ]);

    this.#startBlock = startBlock;
    this.#chainId = chainId;
  }

  public get startBlock(): bigint {
    if (this.#startBlock === undefined) {
      throw new Error("config not initialized");
    }
    return this.#startBlock;
  }

  public get chainId(): number {
    if (this.#chainId === undefined) {
      throw new Error("config not initialized");
    }
    return this.#chainId;
  }
}
