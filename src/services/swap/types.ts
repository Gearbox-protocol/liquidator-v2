import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import type { Wallet } from "ethers";
/**
 * Service that used to swap underlying back to ETH after liquidation
 */
export interface ISwapper {
  launch: (network: NetworkType) => Promise<void>;
  /**
   *
   * @param executor
   * @param tokenAddr
   * @param amount
   * @param recipient
   * @returns txHash or null
   */
  swap: (executor: Wallet, tokenAddr: string, amount: bigint) => Promise<void>;
}
