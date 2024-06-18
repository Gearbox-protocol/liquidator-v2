import type { TransactionReceipt } from "viem";
import { BaseError } from "viem";

export class TransactionRevertedError extends BaseError {
  override name = "TransactionRevertedError";
  public readonly receipt: TransactionReceipt;

  constructor(receipt: TransactionReceipt) {
    super(`transaction ${receipt.transactionHash} reverted`, {
      metaMessages: [],
    });
    this.receipt = receipt;
  }
}
