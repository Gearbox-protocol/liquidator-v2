import type { Address } from "viem";

export interface Balance {
  token: Address;
  balance: bigint;
}
