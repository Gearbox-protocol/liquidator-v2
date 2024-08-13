import type { iBatchLiquidatorAbi } from "@gearbox-protocol/liquidator-v2-contracts/abi";
import type { iRouterV3Abi } from "@gearbox-protocol/types/abi";
import type { AbiParameterToPrimitiveType, ExtractAbiFunction } from "abitype";
import type { GetContractReturnType, PublicClient } from "viem";

import type { ArrayElementType } from "../../index.js";

export type IRouterV3Contract = GetContractReturnType<
  typeof iRouterV3Abi,
  PublicClient
>;

export type RouterResult = AbiParameterToPrimitiveType<
  ExtractAbiFunction<typeof iRouterV3Abi, "findBestClosePath">["outputs"]["0"]
>;

export type EstimateBatchInput = ArrayElementType<
  AbiParameterToPrimitiveType<
    ExtractAbiFunction<
      typeof iBatchLiquidatorAbi,
      "estimateBatch"
    >["inputs"]["0"]
  >
>;
