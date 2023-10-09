import type { NetworkType } from "@gearbox-protocol/sdk";
import type { BigNumberish, Wallet } from "ethers";
/**
 * Service that used to swap underlying back to ETH after liquidation
 */
export interface ISwapper {
  launch: (network: NetworkType) => Promise<void>;
  swap: (
    executor: Wallet,
    tokenAddr: string,
    amount: BigNumberish,
  ) => Promise<void>;
}
