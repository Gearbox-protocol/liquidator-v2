import type { CuratorName } from "@gearbox-protocol/sdk/model";
import {
  findCuratorMarketConfigurator,
  hexEq,
  type MarketSuite,
  type OnchainSDK,
} from "@gearbox-protocol/sdk/onchain";

/**
 * Returns all markets for a given curator
 * If curator is not provided, returns all markets
 * If curator is not found on the network, returns undefined
 * @param sdk
 * @param curator
 * @returns
 */
export function marketsForCurator(
  sdk: OnchainSDK,
  curator?: CuratorName,
): MarketSuite[] | undefined {
  if (!curator) {
    return sdk.marketRegister.markets;
  }
  const marketConfigurator = findCuratorMarketConfigurator(
    curator,
    sdk.networkType,
  );
  if (!marketConfigurator) {
    return undefined;
  }
  return sdk.marketRegister.markets.filter(m =>
    hexEq(m.configurator.address, marketConfigurator),
  );
}
