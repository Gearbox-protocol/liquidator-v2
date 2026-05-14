import {
  type CreditAccountData,
  hexEq,
  type OnchainSDK,
  type SecuritizeRWAFactory,
} from "@gearbox-protocol/sdk";
import type { Address } from "viem";

/**
 * Bundle of contract handles needed to drive a Securitize RWA credit account
 * (the factory that owns it, the DSToken used as the RWA collateral, and the
 * redemption gateway / DS token operator).
 */
export interface RWAContext {
  factory: SecuritizeRWAFactory;
  dsToken: Address;
  gateway: Address;
}

/**
 * Resolves the Securitize RWA context for a credit account.
 * Returns `undefined` if the credit manager is not an RWA credit manager
 * or if the credit account does not have a DSToken balance.
 *
 * Throws on configuration error
 */
export function resolveRWAContext(
  sdk: OnchainSDK,
  ca: CreditAccountData,
): RWAContext | undefined {
  const meta = sdk.tokensMeta.mustGet(ca.underlying);
  if (!sdk.tokensMeta.isRWAUnderlying(meta)) {
    return undefined;
  }
  const factory = sdk.rwa.factories.find(f =>
    hexEq(f.address, meta.rwaFactory),
  );
  if (!factory) {
    throw new Error(
      `RWA factory ${meta.rwaFactory} not found for underlying ${sdk.labelAddress(ca.underlying)}`,
    );
  }
  const dsToken = factory.dsTokens.find(ds =>
    ca.tokens.some(t => hexEq(t.token, ds.address) && t.balance > 0n),
  );
  if (!dsToken) {
    return undefined;
  }
  const gateway = dsToken.operators[0];
  if (!gateway) {
    throw new Error(
      `DS token ${sdk.labelAddress(dsToken.address)} has no operators registered in Securitize factory ${factory.address}`,
    );
  }
  return { factory, dsToken: dsToken.address, gateway };
}
