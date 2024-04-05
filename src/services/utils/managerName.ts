import {
  type CreditAccountData,
  creditManagerByAddress,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk";

export function managerName(ca: CreditAccountData): string {
  const cmSymbol = tokenSymbolByAddress[ca.underlyingToken];
  return (
    creditManagerByAddress[ca.creditManager] ??
    `${ca.creditManager} (${cmSymbol})`
  );
}
