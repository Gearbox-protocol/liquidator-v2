import { MULTICALL_ADDRESS } from "@gearbox-protocol/sdk-gov";
import { IMulticall3__factory } from "@gearbox-protocol/types/v3";
import type { Interface, Overrides, Provider, Signer } from "ethers";

interface Result {
  success: boolean;
  returnData: string;
}

export type InterfaceMethods<T extends Interface> = Parameters<
  T["getFunction"]
>[0];

export interface CallData<T extends Interface> {
  method: InterfaceMethods<T>;
  params?: any;
}

export interface MCall<T extends Interface> {
  address: string;
  interface: T;
  method: InterfaceMethods<T>;
  params?: any;
}

export interface KeyedCall<T extends Interface, K = string> extends MCall<T> {
  key: K;
}

export async function multicall<R extends Array<any>>(
  calls: Array<MCall<any>>,
  p: Signer | Provider,
  overrides?: Overrides,
): Promise<R> {
  const multiCallContract = IMulticall3__factory.connect(MULTICALL_ADDRESS, p);

  const { returnData } = await multiCallContract.aggregate.staticCall(
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
  p: Signer | Provider,
  overrides?: Overrides,
): Promise<Array<{ error?: Error; value?: V }>> {
  if (!calls.length) {
    return [];
  }
  const multiCallContract = IMulticall3__factory.connect(MULTICALL_ADDRESS, p);

  const resp = await multiCallContract.tryAggregate.staticCall(
    false,
    calls.map(c => ({
      target: c.address,
      callData: c.interface.encodeFunctionData(c.method, c.params),
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
