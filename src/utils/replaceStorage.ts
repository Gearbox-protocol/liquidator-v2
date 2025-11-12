import type { AnvilClient } from "@gearbox-protocol/sdk/dev";
import type { Abi } from "abitype";
import {
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type ContractFunctionParameters,
  type EncodeFunctionDataParameters,
  encodeFunctionData,
  numberToHex,
  type ReadContractParameters,
  type ReadContractReturnType,
} from "viem";
import { readContract } from "viem/actions";

export type ReplaceStorageParams<
  abi extends Abi | readonly unknown[] = Abi,
  functionName extends ContractFunctionName<
    abi,
    "pure" | "view"
  > = ContractFunctionName<abi, "pure" | "view">,
  args extends ContractFunctionArgs<
    abi,
    "pure" | "view",
    functionName
  > = ContractFunctionArgs<abi, "pure" | "view", functionName>,
> = ContractFunctionParameters<
  abi,
  "pure" | "view",
  functionName,
  args,
  false
> & {
  value: bigint;
  slotMatch: (
    readVal: ReadContractReturnType<abi, functionName, args>,
    value: bigint,
  ) => boolean;
};

export async function replaceStorage<
  const abi extends Abi | readonly unknown[],
  functionName extends ContractFunctionName<abi, "pure" | "view">,
  const args extends ContractFunctionArgs<abi, "pure" | "view", functionName>,
>(
  client: AnvilClient,
  params: ReplaceStorageParams<abi, functionName, args>,
): Promise<void> {
  const { value, slotMatch, address, abi, functionName, args } = params;
  const newValHex = numberToHex(params.value, { size: 32 });
  const { accessList } = await client.createAccessList({
    to: address,
    data: encodeFunctionData({
      abi,
      functionName,
      args,
    } as EncodeFunctionDataParameters),
  });

  for (const { address: addr_, storageKeys } of accessList) {
    // Address needs to be lower-case to work with setStorageAt.
    const addr = addr_.toLowerCase() as Address;

    for (const slot of storageKeys) {
      try {
        const result = await readContract(client, {
          abi,
          address,
          functionName,
          args,
          stateOverride: [
            {
              address: addr,
              stateDiff: [
                {
                  slot,
                  value: newValHex,
                },
              ],
            },
          ],
        } as ReadContractParameters);

        if (
          slotMatch(
            result as ReadContractReturnType<abi, functionName, args>,
            value,
          )
        ) {
          await client.setStorageAt({
            address,
            index: slot,
            value: newValHex,
          });
          return;
        }
      } catch {}
    }
  }
}
