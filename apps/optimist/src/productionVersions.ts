import { fetchRetry } from "@gearbox-protocol/cli-utils";

import { version } from "./version";

const VERSIONS_URL = "https://monitoring.gearbox.foundation/versions";

export interface ProductionVersions {
  /** Liquidator version deployed in production, optimist's own version if it cannot be read */
  readonly liquidator: Promise<string>;
}

/**
 * Template data for `${versions.*}` keys in optimist configs.
 * Nothing is fetched until a key is read, and the endpoint is fetched at most once.
 */
export function productionVersions(): ProductionVersions {
  let liquidator: Promise<string> | undefined;
  return {
    get liquidator() {
      liquidator ??= fetchLiquidatorVersion();
      return liquidator;
    },
  };
}

async function fetchLiquidatorVersion(): Promise<string> {
  try {
    const response = await fetchRetry(VERSIONS_URL, {
      validateResponse: r => {
        if (!r.ok) {
          throw new Error(`status ${r.status} ${r.statusText}`);
        }
      },
    });
    const versions: unknown = await response.json();
    const liquidator =
      typeof versions === "object" && versions !== null
        ? (versions as Record<string, unknown>).liquidator
        : undefined;
    if (typeof liquidator !== "string" || !liquidator) {
      throw new Error(`no liquidator version in ${JSON.stringify(versions)}`);
    }
    return liquidator;
  } catch (e) {
    console.error(
      `cannot read production liquidator version from ${VERSIONS_URL}, using optimist version ${version}: ${e}`,
    );
    return version;
  }
}
