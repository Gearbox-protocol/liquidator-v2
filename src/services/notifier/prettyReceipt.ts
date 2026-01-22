import { etherscanUrl, type NetworkType } from "@gearbox-protocol/sdk";
import { type Markdown, md } from "@vlad-yakovlev/telegram-md";
import type { TransactionReceipt } from "viem";

interface PrettyReceiptInput {
  receipt?: TransactionReceipt;
  networkType: NetworkType;
}

function receiptPlain({ receipt, networkType }: PrettyReceiptInput): string {
  if (!receipt) {
    throw new Error(`receipt not specified`);
  }
  return etherscanUrl(receipt, networkType);
}

function receiptMd(input: PrettyReceiptInput): Markdown {
  const { receipt } = input;
  if (!receipt) {
    throw new Error(`receipt not specified`);
  }
  return md.link(receipt.transactionHash, receiptPlain(input));
}

const prettyReceipt = {
  plain: receiptPlain,
  md: receiptMd,
};

export default prettyReceipt;
