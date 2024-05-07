import type { TokenBalance } from "@gearbox-protocol/types/v3";

export function filterDust(
  balances: Record<string, TokenBalance>,
): Record<string, bigint> {
  return Object.fromEntries(
    Object.entries(balances)
      .map(([t, { balance }]) => [t, balance] as const)
      .filter(([t, b]) => b > 10n),
  );
}
