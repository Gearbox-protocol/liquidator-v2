import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { productionVersions } from "./productionVersions";
import { version } from "./version";

const fetchMock = vi.fn<typeof fetch>();
const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  errorSpy.mockClear();
});

function respond(body: unknown, status = 200): void {
  fetchMock.mockImplementation(async () =>
    Response.json(body, { status, statusText: "status text" }),
  );
}

async function readLiquidator(): Promise<string> {
  const pending = productionVersions().liquidator;
  await vi.runAllTimersAsync();
  return pending;
}

it("resolves the published liquidator version", async () => {
  respond({ liquidator: "11.4.1", microservices: "4.4.3" });
  await expect(readLiquidator()).resolves.toBe("11.4.1");
  expect(fetchMock).toHaveBeenCalledWith(
    "https://monitoring.gearbox.foundation/versions",
    {},
  );
  expect(errorSpy).not.toHaveBeenCalled();
});

it("fetches once for several reads", async () => {
  respond({ liquidator: "11.4.1" });
  const versions = productionVersions();
  const reads = await Promise.all([
    versions.liquidator,
    versions.liquidator,
    versions.liquidator,
  ]);
  expect(reads).toEqual(["11.4.1", "11.4.1", "11.4.1"]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("does not fetch when never read", () => {
  respond({ liquidator: "11.4.1" });
  productionVersions();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("falls back to optimist version on network failure", async () => {
  fetchMock.mockRejectedValue(new TypeError("fetch failed"));
  await expect(readLiquidator()).resolves.toBe(version);
  expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  expect(errorSpy).toHaveBeenCalledOnce();
  expect(errorSpy.mock.calls[0][0]).toContain("fetch failed");
});

it("falls back to optimist version on non-200 response", async () => {
  respond({ message: "forbidden" }, 403);
  await expect(readLiquidator()).resolves.toBe(version);
  expect(errorSpy).toHaveBeenCalledOnce();
  expect(errorSpy.mock.calls[0][0]).toContain("status 403");
});

it("falls back to optimist version when liquidator key is missing", async () => {
  respond({ microservices: "4.4.3" });
  await expect(readLiquidator()).resolves.toBe(version);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(errorSpy).toHaveBeenCalledOnce();
  expect(errorSpy.mock.calls[0][0]).toContain("no liquidator version");
});
