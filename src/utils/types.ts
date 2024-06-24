import type { iDataCompressorV3Abi } from "@gearbox-protocol/types/abi";
import type { GetContractReturnType, PublicClient } from "viem";

export type Numberish = number | bigint;
export type Arrayish<T> = readonly T[] | T[];

export type ArrayElementType<T> = T extends readonly (infer U)[] | (infer U)[]
  ? U
  : never;

export type IDataCompressorContract = GetContractReturnType<
  typeof iDataCompressorV3Abi,
  PublicClient
>;
