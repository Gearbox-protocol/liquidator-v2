import type { ExecutionReport } from "@gearbox-protocol/liquidator-v2-config";
import type { CuratorName } from "@gearbox-protocol/sdk/model";
import {
  AddressMap,
  AddressSet,
  TypedObjectUtils,
} from "@gearbox-protocol/sdk/onchain";
import type { Address } from "viem";

export interface AccCheckStatus {
  acc: Address;
  cm: Address;
  assets: AddressSet;
  ok: boolean;
}

export interface FailedAccounts {
  whitelisted: AccCheckStatus[];
  nonWhitelisted: AccCheckStatus[];
}

export function getFailedAccounts(
  report: Pick<ExecutionReport, "results" | "whitelist">,
  curator?: CuratorName,
): FailedAccounts {
  const statusByAcc = new AddressMap<AccCheckStatus>();
  for (const r of report.results) {
    const acc = r.account.toLowerCase() as Address;
    const cm = r.creditManager.toLowerCase() as Address;
    const assets = TypedObjectUtils.entries(r.balancesBefore)
      .filter(([_, balance]) => BigInt(balance) > 1n)
      .map(([asset]) => asset);
    const status = statusByAcc.get(r.account) ?? {
      ok: false,
      cm,
      acc,
      assets: new AddressSet(assets),
    };
    status.ok =
      status.ok || !r.isError || (r.isError && !!r.error?.includes("warning:"));
    statusByAcc.upsert(r.account, status);
  }
  const failed = statusByAcc.values().filter(e => !e.ok);
  if (failed.length === 0) {
    return { whitelisted: [], nonWhitelisted: [] };
  }
  // for curator notifications, we ignore the whitelist
  const whitelist = curator
    ? new AddressSet()
    : new AddressSet(report.whitelist?.map(e => e.address));
  const whitelisted: AccCheckStatus[] = [];
  const nonWhitelisted: AccCheckStatus[] = [];

  for (const e of failed) {
    if (
      whitelist.has(e.acc) || // account is whitelisted
      whitelist.has(e.cm) || // credit manager is whitelisted
      whitelist.intersection(e.assets).size > 0 // at least one asset is whitelisted
    ) {
      whitelisted.push(e);
    } else {
      nonWhitelisted.push(e);
    }
  }
  return { whitelisted, nonWhitelisted };
}
