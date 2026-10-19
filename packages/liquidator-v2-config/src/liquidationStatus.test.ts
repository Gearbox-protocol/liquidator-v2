import { describe, expect, it } from "vitest";

import { accountStatus, resultStatus } from "./liquidationStatus.js";

const success = { isError: false };
const warning = { isError: true, error: "warning: not attempted" };
const error = { isError: true, error: "execution reverted" };

describe("resultStatus", () => {
  it("returns success when there is no error", () => {
    expect(resultStatus(success)).toBe("success");
  });

  it("returns warning when error contains 'warning:'", () => {
    expect(resultStatus(warning)).toBe("warning");
  });

  it("returns error for other errors", () => {
    expect(resultStatus(error)).toBe("error");
    expect(resultStatus({ isError: true })).toBe("error");
  });
});

describe("accountStatus", () => {
  it("returns warning for no results", () => {
    expect(accountStatus([])).toBe("warning");
  });

  it("returns success when any track succeeded", () => {
    expect(accountStatus([error, warning, success])).toBe("success");
  });

  it("returns error when nothing succeeded and something failed", () => {
    expect(accountStatus([warning, error])).toBe("error");
  });

  it("returns warning when there are only warnings", () => {
    expect(accountStatus([warning, warning])).toBe("warning");
  });

  it("returns success for whitelisted accounts", () => {
    expect(accountStatus([error], { whitelisted: true })).toBe("success");
    expect(accountStatus([], { whitelisted: true })).toBe("success");
  });
});
