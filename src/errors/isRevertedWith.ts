import { BaseError, ContractFunctionRevertedError, type Hex } from "viem";

// export function isCreditAccountNotLiquidatableException(e: Error): boolean {
//   if (!(e instanceof BaseError)) {
//     return false;
//   }

//   const err = e.walk(i => i instanceof ContractFunctionRevertedError);
//   if (err instanceof ContractFunctionRevertedError) {
//     // CreditAccountNotLiquidatableException()
//     return err.raw === "0x234b893b";
//   }
//   return false;
// }

// export function isCreditAccountNotLiquidatableWithLossExceptionException(
//   e: Error,
// ): boolean {
//   if (!(e instanceof BaseError)) {
//     return false;
//   }

//   const err = e.walk(i => i instanceof ContractFunctionRevertedError);
//   if (err instanceof ContractFunctionRevertedError) {
//     // CreditAccountNotLiquidatableWithLossException()
//     return err.raw === "0x6b8c2b8c";
//   }
//   return false;
// }

export function isRevertedWith(e: Error, revertCode: Hex): boolean {
  if (!(e instanceof BaseError)) {
    return false;
  }

  const err = e.walk(i => i instanceof ContractFunctionRevertedError);
  if (err instanceof ContractFunctionRevertedError) {
    // CreditAccountNotLiquidatableWithLossException()
    return err.raw === revertCode;
  }
  return false;
}
