import type {
  ExecutionReport,
  OptimisticResult,
  WhitelistEntry,
} from "@gearbox-protocol/liquidator-v2-config";
import type { Address } from "viem";
import { describe, expect, it } from "vitest";

import { getFailedAccounts } from "./getFailedAccounts";

const ACC_1: Address = "0x1111111111111111111111111111111111111111";
const ACC_2: Address = "0x2222222222222222222222222222222222222222";
const CM: Address = "0x3333333333333333333333333333333333333333";
const ASSET: Address = "0x4444444444444444444444444444444444444444";

type Outcome = "success" | "warning" | "error";

function result(
  account: Address,
  trackId: string,
  outcome: Outcome,
): OptimisticResult {
  return {
    account,
    trackId,
    creditManager: CM,
    balancesBefore: { [ASSET]: "100" },
    isError: outcome !== "success",
    error:
      outcome === "warning"
        ? "warning: not attempted"
        : outcome === "error"
          ? "execution reverted"
          : undefined,
  } as OptimisticResult;
}

function report(
  results: OptimisticResult[],
  whitelist: Address[] = [],
): Pick<ExecutionReport, "results" | "whitelist"> {
  return {
    results,
    whitelist: whitelist.map(address => ({ address }) as WhitelistEntry),
  };
}

const withWhitelist = { useWhitelist: true };

describe("getFailedAccounts", () => {
  it("returns nothing when every account succeeded on some track", () => {
    const r = report([
      result(ACC_1, "full", "error"),
      result(ACC_1, "partial", "success"),
      result(ACC_2, "full", "success"),
    ]);
    expect(getFailedAccounts(r, withWhitelist)).toEqual([]);
  });

  it("treats warnings as neutral", () => {
    const r = report([
      result(ACC_1, "full", "error"),
      result(ACC_1, "partial", "warning"),
      result(ACC_2, "full", "warning"),
    ]);
    expect(getFailedAccounts(r, withWhitelist)).toEqual([
      { acc: ACC_1, cm: CM },
    ]);
  });

  it.each([
    ["account", ACC_1],
    ["credit manager", CM],
    ["asset", ASSET],
  ])("skips accounts whose %s is whitelisted", (_, address) => {
    const r = report([result(ACC_1, "full", "error")], [address]);
    expect(getFailedAccounts(r, withWhitelist)).toEqual([]);
  });

  it("ignores the whitelist when asked to", () => {
    const r = report([result(ACC_1, "full", "error")], [ACC_1]);
    expect(getFailedAccounts(r, { useWhitelist: false })).toEqual([
      { acc: ACC_1, cm: CM },
    ]);
  });
});
