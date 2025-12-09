import { BaseContract, type GearboxSDK } from "@gearbox-protocol/sdk";
import { iPartialLiquidationBotV310Abi } from "@gearbox-protocol/sdk/plugins/bots";
import type { Address } from "viem";

const abi = iPartialLiquidationBotV310Abi;
type abi = typeof abi;

export class PartialLiquidationBotV310Contract extends BaseContract<abi> {
  public static get(
    sdk: GearboxSDK,
    address: Address,
  ): PartialLiquidationBotV310Contract {
    const existing = sdk.contracts.get(address) as
      | PartialLiquidationBotV310Contract
      | undefined;
    return existing ?? new PartialLiquidationBotV310Contract(sdk, address);
  }

  #minHealthFactor?: bigint;
  #maxHealthFactor?: bigint;

  constructor(sdk: GearboxSDK, address: Address) {
    super(sdk, {
      abi,
      addr: address,
      contractType: "partialLiquidationBot",
      version: 310,
    });
  }

  public async loadHealthFactors(): Promise<[bigint, bigint]> {
    if (!this.#minHealthFactor || !this.#maxHealthFactor) {
      const [minHealthFactor, maxHealthFactor] = await this.client.multicall({
        contracts: [
          {
            address: this.address,
            abi: this.abi,
            functionName: "minHealthFactor",
          },
          {
            address: this.address,
            abi: this.abi,
            functionName: "maxHealthFactor",
          },
        ],
        allowFailure: false,
      });
      this.#minHealthFactor = BigInt(minHealthFactor);
      this.#maxHealthFactor = BigInt(maxHealthFactor);
    }
    return [this.#minHealthFactor, this.#maxHealthFactor];
  }

  public get minHealthFactor(): bigint {
    if (!this.#minHealthFactor) {
      throw new Error("minHealthFactor not loaded");
    }
    return this.#minHealthFactor;
  }

  public get maxHealthFactor(): bigint {
    if (!this.#maxHealthFactor) {
      throw new Error("maxHealthFactor not loaded");
    }
    return this.#maxHealthFactor;
  }
}
