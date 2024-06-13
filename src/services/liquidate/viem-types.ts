import type {
  iLiquidatorAbi,
  iPriceHelperAbi,
} from "@gearbox-protocol/liquidator-v2-contracts/abi";
import type { GetContractReturnType, PublicClient } from "viem";

export type IPriceHelperContract = GetContractReturnType<
  typeof iPriceHelperAbi,
  PublicClient
>;

export type ILiquidatorContract = GetContractReturnType<
  typeof iLiquidatorAbi,
  PublicClient
>;
