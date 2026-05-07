import { hexEq, type OnchainSDK } from "@gearbox-protocol/sdk";
import type { Address } from "viem";

/**
 * Resolves the Securitize redemption gateway (DS token operator) for a credit
 * manager whose underlying is an RWA token wrapping a DS token.
 *
 * Returns `undefined` if the underlying is not an RWA underlying (so callers
 * can use it as a quick "is this a Securitize RWA CM?" check).
 *
 * Throws if the underlying is RWA but the matching Securitize factory or
 * DS token operator cannot be found - that indicates a misconfiguration.
 */
export function resolveRedemptionGateway(
  sdk: OnchainSDK,
  underlying: Address,
): Address | undefined {
  const meta = sdk.tokensMeta.mustGet(underlying);
  if (!sdk.tokensMeta.isRWAUnderlying(meta)) {
    return undefined;
  }
  const factory = sdk.rwa.factories.find(f =>
    hexEq(f.address, meta.rwaFactory),
  );
  if (!factory) {
    throw new Error(
      `RWA factory ${meta.rwaFactory} not found for underlying ${sdk.labelAddress(underlying)}`,
    );
  }
  const dsToken = factory.dsTokens[0];
  if (!dsToken) {
    throw new Error(
      `Securitize factory ${factory.address} has no DS tokens registered`,
    );
  }
  const operator = dsToken.operators[0];
  if (!operator) {
    throw new Error(
      `DS token ${sdk.labelAddress(dsToken.address)} has no operators registered in Securitize factory ${factory.address}`,
    );
  }
  return operator;
}
