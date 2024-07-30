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
    | string
    | { timestamp: number | bigint | string }
    | { ts: number | bigint | string }
    | null
    | undefined,
): string {
  if (!t) {
    return "null";
  }
  const ts = typeof t === "object" ? ("ts" in t ? t.ts : t.timestamp) : t;
  const d = new Date(Number(ts) * 1000);
  return `${format(d, "dd/MM/yy HH:mm:ss")} (${ts})`;
}
