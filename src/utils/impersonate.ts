import type { JsonRpcProvider, JsonRpcSigner, Provider } from "ethers";

export async function impersonate(
  provider: Provider,
  address: string,
): Promise<JsonRpcSigner> {
  await (provider as JsonRpcProvider).send("anvil_impersonateAccount", [
    address,
  ]);
  // await (provider as JsonRpcProvider).send("anvil_setBalance", [
  //   address,
  //   "0x10000000000000000000",
  // ]);
  return (provider as JsonRpcProvider).getSigner(address);
}

export async function stopImpersonate(
  provider: Provider,
  address: string,
): Promise<void> {
  await (provider as JsonRpcProvider).send("anvil_stopImpersonatingAccount", [
    address,
  ]);
}
