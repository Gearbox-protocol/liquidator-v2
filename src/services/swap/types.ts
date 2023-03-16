import { BigNumberish, Wallet } from "ethers";
/**
 * Service that used to swap underlying back to ETH after liquidation
 */
export interface ISwapper {
  swap: (
    executor: Wallet,
    tokenAddr: string,
    amount: BigNumberish,
  ) => Promise<void>;
}
