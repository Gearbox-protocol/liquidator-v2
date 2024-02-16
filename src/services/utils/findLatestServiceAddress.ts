import type { IAddressProviderV3 } from "@gearbox-protocol/sdk";
import { ethers } from "ethers";

import { getLogger } from "../../log";

export async function findLatestServiceAddress(
  ap: IAddressProviderV3,
  service: string,
  minVersion: number,
  maxVersion: number,
): Promise<string> {
  const logger = getLogger("address_provider");
  const logs = await ap.provider.getLogs(
    ap.filters.SetAddress(ethers.utils.formatBytes32String(service)),
  );
  let version = minVersion;
  let address = "";
  for (const l of logs) {
    const e = ap.interface.parseLog(l);
    const v = e.args.version.toNumber();
    if (v >= version && v <= maxVersion) {
      version = v;
      address = e.args.value;
    }
  }

  if (!address) {
    throw new Error(`cannot find latest ${service}`);
  }
  logger.debug(`latest version of ${service}: v${version} at ${address}`);

  return address;
}
