import type { CallOverrides, Signer } from "ethers";
import { ethers } from "ethers";

export const MULTICALL_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

const _abi = [
  {
    inputs: [
      {
        components: [
          {
            internalType: "address",
            name: "target",
            type: "address",
          },
          {
            internalType: "bytes",
            name: "callData",
            type: "bytes",
          },
        ],
        internalType: "struct Multicall2.Call[]",
        name: "calls",
        type: "tuple[]",
      },
    ],
    name: "aggregate",
    outputs: [
      {
        internalType: "uint256",
        name: "blockNumber",
        type: "uint256",
      },
      {
        internalType: "bytes[]",
        name: "returnData",
        type: "bytes[]",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },

  {
    inputs: [
      {
        internalType: "bool",
        name: "requireSuccess",
        type: "bool",
      },
      {
        components: [
          {
            internalType: "address",
            name: "target",
            type: "address",
          },
          {
            internalType: "bytes",
            name: "callData",
            type: "bytes",
          },
        ],
        internalType: "struct Multicall2.Call[]",
        name: "calls",
        type: "tuple[]",
      },
    ],
    name: "tryAggregate",
    outputs: [
      {
        components: [
          {
            internalType: "bool",
            name: "success",
            type: "bool",
          },
          {
            internalType: "bytes",
            name: "returnData",
            type: "bytes",
          },
        ],
        internalType: "struct Multicall2.Result[]",
        name: "returnData",
        type: "tuple[]",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
];

export const multicallInterface = new ethers.utils.Interface(_abi);

interface Result {
  success: boolean;
  returnData: string;
}

export interface CallData<T extends ethers.utils.Interface> {
  method: keyof T["functions"];
  params?: any;
}

export interface MCall<T extends ethers.utils.Interface> {
  address: string;
  interface: T;
  method: keyof T["functions"];
  params?: any;
}

export interface KeyedCall<T extends ethers.utils.Interface, K = string>
  extends MCall<T> {
  key: K;
}

export async function multicall<R extends Array<any>>(
  calls: Array<MCall<any>>,
  p: Signer | ethers.providers.Provider,
  overrides?: CallOverrides,
): Promise<R> {
  const multiCallContract = new ethers.Contract(
    MULTICALL_ADDRESS,
    multicallInterface,
    p,
  );

  const { returnData } = await multiCallContract.callStatic.aggregate(
    calls.map(c => ({
      target: c.address,
      callData: c.interface.encodeFunctionData(c.method as string, c.params),
    })),
    overrides || {},
  );

  return (returnData as Array<string>)
    .map((d, num) =>
      calls[num].interface.decodeFunctionResult(calls[num].method as string, d),
    )
    .map(unwrapArray) as R;
}

/**
 * Like multicall from sdk, but uses tryAggregate instead of aggregate
 * @param calls
 * @param p
 * @param overrides
 * @returns
 */
export async function safeMulticall<V = any, T extends MCall<any> = MCall<any>>(
  calls: T[],
  p: Signer | ethers.providers.Provider,
  overrides?: CallOverrides,
): Promise<Array<{ error?: Error; value?: V }>> {
  if (!calls.length) {
    return [];
  }
  const multiCallContract = new ethers.Contract(
    MULTICALL_ADDRESS,
    multicallInterface,
    p,
  );

  const resp = await multiCallContract.callStatic.tryAggregate(
    false,
    calls.map(c => ({
      target: c.address,
      callData: c.interface.encodeFunctionData(c.method as string, c.params),
    })),
    overrides ?? {},
  );

  return (resp as Array<Result>).map((d, num) => {
    let value: V | undefined;
    let error: Error | undefined;
    if (d.success) {
      try {
        value = unwrapArray(
          calls[num].interface.decodeFunctionResult(
            calls[num].method as string,
            d.returnData,
          ),
        );
      } catch (e) {
        if (e instanceof Error) {
          error = e;
        } else {
          error = new Error(`${e}`);
        }
      }
    } else {
      error = new Error("multicall call failed");
    }
    return { error, value };
  });
}

function unwrapArray<V>(data: unknown): V {
  if (!data) {
    return data as V;
  }
  if (Array.isArray(data)) {
    return data.length === 1 ? data[0] : data;
  }
  return data as V;
}

export class MultiCallContract<T extends ethers.utils.Interface> {
  private readonly _address: string;

  private readonly _interface: T;

  protected _multiCall: ethers.Contract;

  constructor(
    address: string,
    intrerface: T,
    provider: ethers.providers.Provider | Signer,
  ) {
    this._address = address;
    this._interface = intrerface;

    this._multiCall = new ethers.Contract(
      MULTICALL_ADDRESS,
      multicallInterface,
      provider,
    );
  }

  async call<R extends Array<any>>(
    data: Array<CallData<T>>,
    overrides?: CallOverrides,
  ): Promise<R> {
    const { returnData } = await this._multiCall.callStatic.aggregate(
      data.map(c => ({
        target: this._address,
        callData: this._interface.encodeFunctionData(
          c.method as string,
          c.params,
        ),
      })),
      overrides || {},
    );

    return (returnData as Array<string>)
      .map((d, num) =>
        this._interface.decodeFunctionResult(data[num].method as string, d),
      )
      .map(r => r[0]) as R;
  }

  get address(): string {
    return this._address;
  }

  get interface(): T {
    return this._interface;
  }
}
