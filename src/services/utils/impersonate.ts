import type { ethers, providers } from "ethers";

export async function impersonate(
  provider: providers.Provider,
  address: string,
): Promise<ethers.providers.JsonRpcSigner> {
  await (provider as providers.JsonRpcProvider).send(
    "anvil_impersonateAccount",
    [address],
  );
  // await (provider as providers.JsonRpcProvider).send("anvil_setBalance", [
  //   address,
  //   "0x10000000000000000000",
  // ]);
  return (provider as providers.JsonRpcProvider).getSigner(address);
}

export async function stopImpersonate(
  provider: providers.Provider,
  address: string,
): Promise<void> {
  await (provider as providers.JsonRpcProvider).send(
    "anvil_stopImpersonatingAccount",
    [address],
  );
}
