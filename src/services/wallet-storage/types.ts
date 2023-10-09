import type { Wallet } from "ethers";

export interface IWalletStorage {
  launch: () => Promise<void>;
  /**
   * Gets wallet or creates it if not exists with password from config
   * @param num Wallet index
   * @return promise to wallet
   */
  getOrCreateKey: (num: number) => Promise<Wallet>;
}
