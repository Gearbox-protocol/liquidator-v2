import { CreditAccountsService, GearboxSDK } from "@gearbox-protocol/sdk";

import type { Config } from "./config/index.js";
import { DI } from "./di.js";
import type { ILogger } from "./log/index.js";
import type Client from "./services/Client.js";
import { formatTs } from "./utils/index.js";

export default async function attachSDK(): Promise<CreditAccountsService> {
  const config: Config = DI.get(DI.Config);
  const client: Client = DI.get(DI.Client);
  const logger: ILogger = DI.create(DI.Logger, "sdk");

  await client.launch();
  let optimisticTimestamp: number | undefined;
  if (config.optimistic) {
    const block = await client.pub.getBlock({
      blockNumber: client.anvilForkBlock,
    });
    if (!block) {
      throw new Error("cannot get latest block");
    }
    logger.info(
      { tag: "timing" },
      `optimistic fork block ${block.number} ${new Date(Number(block.timestamp) * 1000)}`,
    );
    // https://github.com/redstone-finance/redstone-oracles-monorepo/blob/c7569a8eb7da1d3ad6209dfcf59c7ca508ea947b/packages/sdk/src/request-data-packages.ts#L82
    // we round the timestamp to full minutes for being compatible with
    // oracle-nodes, which usually work with rounded 10s and 60s intervals
    //
    // Also, when forking anvil->anvil (when running on testnets) block.timestamp can be in future because min ts for block is 1 seconds,
    // and scripts can take dozens of blocks (hundreds for faucet). So we take min value;
    const nowMs = new Date().getTime();
    const redstoneIntervalMs = 60_000;
    const anvilTsMs =
      redstoneIntervalMs *
      Math.floor((Number(block.timestamp) * 1000) / redstoneIntervalMs);
    const fromNowTsMs =
      redstoneIntervalMs * Math.floor(nowMs / redstoneIntervalMs - 1);
    optimisticTimestamp = Math.min(anvilTsMs, fromNowTsMs);
    const deltaS = Math.floor((nowMs - optimisticTimestamp) / 1000);
    logger.info(
      { tag: "timing" },
      `will use optimistic timestamp: ${new Date(optimisticTimestamp)} (${optimisticTimestamp}, delta: ${deltaS}s)`,
    );
  }

  const sdk = await GearboxSDK.attach({
    rpcURLs: config.ethProviderRpcs,
    addressProvider: config.addressProviderOverride,
    marketConfigurators: [config.marketConfigurator],
    timeout: 600_000,
    chainId: config.chainId,
    networkType: config.network,
    redstoneHistoricTimestamp: optimisticTimestamp,
    logger,
  });
  if (config.optimistic) {
    // in optimistic mode, warp time if redstone timestamp does not match it
    sdk.priceFeeds.addHook("updatesGenerated", async ({ timestamp }) => {
      try {
        const block = await client.anvil.evmMineDetailed(timestamp);
        logger.debug({ tag: "timing" }, `new block ts: ${formatTs(block)}`);
      } catch {}
    });
  }
  const service = new CreditAccountsService(sdk, {
    batchSize: config.compressorBatchSize,
  });

  return service;
}
