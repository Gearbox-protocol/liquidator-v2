import { format } from "date-fns";

/**
 * Formats block timestamp or something that contains it
 * @param t
 * @returns
 */
export function formatTs(
  t:
    | number
    | bigint
    | { timestamp: number | bigint }
    | { ts: number | bigint }
    | null
    | undefined,
): string {
  if (!t) {
    return "null";
  }
  const ts =
    typeof t === "number" || typeof t === "bigint"
      ? t
      : "ts" in t
        ? t.ts
        : t.timestamp;
  const d = new Date(Number(ts) * 1000);
  return `${format(d, "dd/MM/yy HH:mm:ss")} (${ts})`;
}
