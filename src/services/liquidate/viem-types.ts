import type {
  iBatchLiquidatorAbi,
  iLiquidatorAbi,
  iPriceHelperAbi,
} from "@gearbox-protocol/liquidator-v2-contracts/abi";
import type { AbiParameterToPrimitiveType, ExtractAbiFunction } from "abitype";
import type { GetContractReturnType, PublicClient } from "viem";

import type { ArrayElementType } from "../../utils/index.js";

export type IPriceHelperContract = GetContractReturnType<
  typeof iPriceHelperAbi,
  PublicClient
>;

export type ILiquidatorContract = GetContractReturnType<
  typeof iLiquidatorAbi,
  PublicClient
>;

export type TokenPriceInfo = ArrayElementType<
  AbiParameterToPrimitiveType<
    ExtractAbiFunction<typeof iPriceHelperAbi, "previewTokens">["outputs"]["0"]
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
