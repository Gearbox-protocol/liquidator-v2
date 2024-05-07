export function filterDust(
  balances: Record<string, bigint>,
): Record<string, bigint> {
  return Object.fromEntries(
    Object.entries(balances).filter(([t, b]) => b > 10n),
  );
}
