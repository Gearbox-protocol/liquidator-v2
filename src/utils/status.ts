export type StatusCode = "healthy" | "warning" | "alert";

const statusCodeOrder: Record<StatusCode, number> = {
  healthy: 0,
  warning: 1,
  alert: 2,
};

export function maxStatusCode(
  ...codes: Array<StatusCode | undefined>
): StatusCode {
  let status: StatusCode = "healthy";
  for (const code of codes) {
    if (!code) {
      continue;
    }
    status = statusCodeOrder[code] > statusCodeOrder[status] ? code : status;
  }
  return status;
}
