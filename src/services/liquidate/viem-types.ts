import type {
  iBatchLiquidatorAbi,
  iPartialLiquidatorAbi,
} from "@gearbox-protocol/liquidator-v2-contracts/abi";
import type { AbiParameterToPrimitiveType, ExtractAbiFunction } from "abitype";
import type { GetContractReturnType, PublicClient } from "viem";

import type { ArrayElementType } from "../../utils/index.js";

export type IPartialLiquidatorContract = GetContractReturnType<
  typeof iPartialLiquidatorAbi,
  PublicClient
>;

export type EstimateBatchInput = ArrayElementType<
  AbiParameterToPrimitiveType<
    ExtractAbiFunction<
      typeof iBatchLiquidatorAbi,
      "estimateBatch"
    >["inputs"]["0"]
  >
>;

export type BatchLiquidationResult = ArrayElementType<
  AbiParameterToPrimitiveType<
    ExtractAbiFunction<
      typeof iBatchLiquidatorAbi,
      "estimateBatch"
    >["outputs"]["0"]
  >
>;

export type LiquidateBatchInput = ArrayElementType<
  AbiParameterToPrimitiveType<
    ExtractAbiFunction<
      typeof iBatchLiquidatorAbi,
      "liquidateBatch"
    >["inputs"]["0"]
  >
>;
