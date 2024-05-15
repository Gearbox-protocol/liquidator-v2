import { format } from "date-fns";

/**
 * Formats block timestamp or something that contains it
 * @param t
 * @returns
 */
export function formatTs(
  t: number | { timestamp: number } | { ts: number } | null | undefined,
): string {
  if (!t) {
    return "null";
  }
  const ts = typeof t === "number" ? t : "ts" in t ? t.ts : t.timestamp;
  const d = new Date(ts * 1000);
  return `${format(d, "dd/MM/yy HH:mm:ss")} (${ts})`;
}
