import {
  type CreditAccountData,
  hexEq,
  type ILogger,
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
  logger: ILogger,
): RWAContext | undefined {
  const meta = sdk.tokensMeta.mustGet(ca.underlying);
  if (!sdk.tokensMeta.isRWAUnderlying(meta)) {
    logger.warn(
      `Underlying ${sdk.labelAddress(ca.underlying)} is not an RWA underlying`,
    );
    return undefined;
  }
  const factory = sdk.rwa.factories.find(f =>
    hexEq(f.address, meta.rwaFactory),
  );
  if (!factory) {
    logger.error(
      `RWA factory ${meta.rwaFactory} not found for underlying ${sdk.labelAddress(ca.underlying)}`,
    );
    throw new Error(
      `RWA factory ${meta.rwaFactory} not found for underlying ${sdk.labelAddress(ca.underlying)}`,
    );
  }
  logger.debug(
    `Found RWA factory ${factory.address} for underlying ${sdk.labelAddress(ca.underlying)}`,
  );
  const cm = sdk.marketRegister.findCreditManager(ca.creditManager);
  // look up by credit manager tokens, because we redeem all DSTokens during makeLiquidatable
  const dsToken = factory.dsTokens.find(ds =>
    cm.creditManager.collateralTokens.some(t => hexEq(t, ds.address)),
  );
  if (!dsToken) {
    logger.warn(
      `No DSToken found for underlying ${sdk.labelAddress(ca.underlying)}`,
    );
    return undefined;
  }
  logger.debug(
    `Found DSToken ${sdk.labelAddress(dsToken.address)} for underlying ${sdk.labelAddress(ca.underlying)}`,
  );
  const gateway = dsToken.operators[0];
  logger.debug(
    `Found gateway ${gateway} for DSToken ${sdk.labelAddress(dsToken.address)}`,
  );
  if (!gateway) {
    throw new Error(
      `DS token ${sdk.labelAddress(dsToken.address)} has no operators registered in Securitize factory ${factory.address}`,
    );
  }
  return { factory, dsToken: dsToken.address, gateway };
}
