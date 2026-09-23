import type { Config } from "@gearbox-protocol/liquidator-v2-config";
import type { RouterV310Contract } from "@gearbox-protocol/sdk/onchain";
import { OnchainSDK, VERSION_RANGE_310 } from "@gearbox-protocol/sdk/onchain";
import { BotsPlugin } from "@gearbox-protocol/sdk/plugins/bots";
import type { Transport } from "viem";
import { DI } from "./di.js";
import type { ILogger } from "./log/index.js";
import type Client from "./services/Client.js";
import { formatTs } from "./utils/index.js";

export default async function attachSDK(): Promise<
  OnchainSDK<{ bots: BotsPlugin }>
> {
  const config: Config = DI.get(DI.Config);
  const client: Client = DI.get(DI.Client);
  const logger: ILogger = DI.create(DI.Logger, "sdk");
  const transport: Transport = DI.get(DI.Transport);

  await client.launch();

  let gasLimit: bigint | undefined | null = config.gasLimit;
  if (config.gasLimit === -1n) {
    gasLimit = null;
  }

  const sdk = new OnchainSDK(
    config.network,
    { transport },
    {
      gasLimit,
      logger,
      plugins: {
        bots: new BotsPlugin(config.liquidationMode === "deleverage"),
      },
    },
  );
  await sdk.attach({
    addressProvider: config.addressProvider,
    marketConfigurators: config.marketConfigurators,
    rwaFactories: config.rwaFactories,
    // we need prices to calculate things like numsplits
    ignoreUpdateablePrices: false,
  });
  // trying to set default numSplits for router v3.1 contract
  try {
    const router = sdk.routerFor(VERSION_RANGE_310) as RouterV310Contract;
    router.setDefaultNumSplits(config.numSplits);
    logger.info(
      `set default numSplits to ${config.numSplits} on router ${router.address}`,
    );
  } catch {}

  if (config.optimistic && sdk.priceFeeds.updatesSupported) {
    // warp time if price update timestamp does not match block timestamp
    sdk.priceFeeds.addHook("updatesGenerated", async ({ timestamp }) => {
      try {
        const block = await client.anvil.evmMineDetailed(timestamp);
        logger.debug({ tag: "timing" }, `new block ts: ${formatTs(block)}`);
      } catch {}
    });
    // re-sync to re-trigger price feed updates now that the hook is attached
    await sdk.syncState({
      blockNumber: sdk.currentBlock,
      timestamp: sdk.timestamp,
    });
  }
  return sdk;
}
