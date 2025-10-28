import { BaseError, ContractFunctionRevertedError } from "viem";

export function isCreditAccountNotLiquidatableException(e: Error): boolean {
  if (!(e instanceof BaseError)) {
    return false;
  }

  const err = e.walk(i => i instanceof ContractFunctionRevertedError);
  if (err instanceof ContractFunctionRevertedError) {
    // CreditAccountNotLiquidatableException()
    return err.raw === "0x234b893b";
  }
  return false;
}
