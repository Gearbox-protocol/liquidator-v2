import {
  accountStatus,
  type ExecutionReport,
  type OptimisticResult,
} from "@gearbox-protocol/liquidator-v2-config";
import {
  AddressMap,
  AddressSet,
  TypedObjectUtils,
} from "@gearbox-protocol/sdk/onchain";
import type { Address } from "viem";

export interface FailedAccount {
  acc: Address;
  cm: Address;
}

export interface GetFailedAccountsOptions {
  /**
   * Whitelisted accounts are never failed. Curator notifications and the manual role ignore the whitelist
   */
  useWhitelist: boolean;
}

/**
 * Returns accounts whose {@link accountStatus} is `error`
 */
export function getFailedAccounts(
  report: Pick<ExecutionReport, "results" | "whitelist">,
  options: GetFailedAccountsOptions,
): FailedAccount[] {
  const resultsByAcc = new AddressMap<OptimisticResult[]>();
  for (const r of report.results) {
    resultsByAcc.upsert(r.account, [...(resultsByAcc.get(r.account) ?? []), r]);
  }
  const whitelist = new AddressSet(
    options.useWhitelist ? report.whitelist?.map(e => e.address) : [],
  );

  const failed: FailedAccount[] = [];
  for (const [account, results] of resultsByAcc.entries()) {
    const acc = account.toLowerCase() as Address;
    const cm = results[0].creditManager.toLowerCase() as Address;
    const assets = new AddressSet(
      results.flatMap(r =>
        TypedObjectUtils.entries(r.balancesBefore)
          .filter(([_, balance]) => BigInt(balance) > 1n)
          .map(([asset]) => asset),
      ),
    );
    const whitelisted =
      whitelist.has(acc) || // account is whitelisted
      whitelist.has(cm) || // credit manager is whitelisted
      whitelist.intersection(assets).size > 0; // at least one asset is whitelisted
    if (accountStatus(results, { whitelisted }) === "error") {
      failed.push({ acc, cm });
    }
  }
  return failed;
}
