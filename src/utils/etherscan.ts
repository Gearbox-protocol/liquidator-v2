import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import type { TransactionReceipt } from "ethers";

import type { CreditAccountData } from "./ethers-6-temp";

export type EtherscanURLParam =
  | { block: number }
  | { tx: string }
  | { address: string };

export function etherscanUrl(
  entity: EtherscanURLParam | TransactionReceipt | CreditAccountData,
  network: NetworkType,
): string {
  let [prefix, domain] = ["", "etherscan.io"];

  let param: EtherscanURLParam;
  if ("hash" in entity && "blockHash" in entity) {
    param = { tx: entity.hash };
  } else if ("addr" in entity && "creditManager" in entity) {
    param = { address: entity.addr };
  } else {
    param = entity;
  }

  switch (network) {
    case "Optimism":
      prefix = "optimistic.";
      break;
    case "Arbitrum":
      domain = "arbiscan.io";
      break;
    case "Base":
      domain = "basescan.org";
      break;
  }
  const [key, value] = Object.entries(param)[0];
  return `https://${prefix}${domain}/${key}/${value}`;
}
