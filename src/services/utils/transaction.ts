import type { ContractReceipt, ContractTransaction, ethers } from "ethers";
import pRetry from "p-retry";

/**
 * Mines transaction on anvil. Because sometimes it gets stuck for unknown reasons,
 * add retries and timeout
 * @param tx
 * @returns
 */
export async function mine(
  provider: ethers.providers.JsonRpcProvider,
  tx: ContractTransaction,
  interval = 12_000,
  retries = 5,
): Promise<ContractReceipt> {
  await provider.send("evm_mine", []).catch(() => {});
  const run = async () => {
    const receipt: ContractReceipt = await Promise.race([
      tx.wait(),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("mine timeout"));
        }, interval);
      }),
    ]);
    return receipt;
  };

  return pRetry(run, { retries });
}
