import type { iRouterV3Abi } from "@gearbox-protocol/types/abi";
import type { AbiParameterToPrimitiveType, ExtractAbiFunction } from "abitype";
import type { GetContractReturnType, PublicClient } from "viem";

export type IRouterV3Contract = GetContractReturnType<
  typeof iRouterV3Abi,
  PublicClient
>;

export type RouterResult = AbiParameterToPrimitiveType<
  ExtractAbiFunction<typeof iRouterV3Abi, "findBestClosePath">["outputs"]["0"]
>;
