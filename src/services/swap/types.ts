import type { NetworkType } from "@gearbox-protocol/sdk";
import type { Address } from "viem";
/**
 * Service that used to swap underlying back to ETH after liquidation
 */
export interface ISwapper {
  launch: (network: NetworkType) => Promise<void>;
  swap: (tokenAddr: Address, amount: bigint) => Promise<void>;
}
