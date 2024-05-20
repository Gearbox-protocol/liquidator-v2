import type { JsonRpcProvider, JsonRpcSigner, Provider } from "ethers";

export async function impersonate(
  provider: Provider,
  address: string,
  topUpBalance = true,
): Promise<JsonRpcSigner> {
  await (provider as JsonRpcProvider).send("anvil_impersonateAccount", [
    address,
  ]);
  if (topUpBalance) {
    await (provider as JsonRpcProvider).send("anvil_setBalance", [
      address,
      "0x10000000000000000000",
    ]);
  }
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
