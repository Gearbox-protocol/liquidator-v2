import type {
  ICreditAccountsService,
  RouterV310Contract,
} from "@gearbox-protocol/sdk";
import {
  createCreditAccountService,
  GearboxSDK,
  VERSION_RANGE_310,
} from "@gearbox-protocol/sdk";
import { createTransport } from "@gearbox-protocol/sdk/dev";

import type { Config } from "./config/index.js";
import { DI } from "./di.js";
import type { ILogger } from "./log/index.js";
import type Client from "./services/Client.js";
import { formatTs } from "./utils/index.js";

export default async function attachSDK(): Promise<ICreditAccountsService> {
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
    const nowMs = Date.now();
    if (config.optimisticTimestamp) {
      optimisticTimestamp = config.optimisticTimestamp;
    } else {
      const redstoneIntervalMs = 60_000;
      const anvilTsMs =
        redstoneIntervalMs *
        Math.floor((Number(block.timestamp) * 1000) / redstoneIntervalMs);
      const fromNowTsMs =
        redstoneIntervalMs * Math.floor(nowMs / redstoneIntervalMs - 1);
      optimisticTimestamp = Math.min(anvilTsMs, fromNowTsMs);
    }
    const deltaS = Math.floor((nowMs - optimisticTimestamp) / 1000);
    logger.info(
      { tag: "timing" },
      `will use optimistic timestamp: ${new Date(optimisticTimestamp)} (${optimisticTimestamp}, delta: ${deltaS}s)`,
    );
  }

  const transport = createTransport({
    rpcProviders: [
      {
        provider: "alchemy",
        keys: config.alchemyKeys?.map(k => k.value) ?? [],
      },
      { provider: "drpc", keys: config.drpcKeys?.map(k => k.value) ?? [] },
    ],
    rpcUrls: config.jsonRpcProviders?.map(k => k.value) ?? [],
    protocol: "http",
    network: config.network,
    timeout: 600_000,
  });

  const sdk = await GearboxSDK.attach({
    transport,
    addressProvider: config.addressProvider,
    marketConfigurators: config.marketConfigurators,
    chainId: config.chainId,
    networkType: config.network,
    redstone: {
      historicTimestamp: optimisticTimestamp,
      gateways: config.redstoneGateways,
    },
    logger,
  });
  // trying to set default numSplits for router v3.1 contract
  try {
    const router = sdk.routerFor(VERSION_RANGE_310) as RouterV310Contract;
    router.setDefaultNumSplits(config.numSplits);
    logger.info(
      `set default numSplits to ${config.numSplits} on router ${router.address}`,
    );
  } catch {}

  if (config.optimistic) {
    // in optimistic mode, warp time if redstone timestamp does not match it
    sdk.priceFeeds.addHook("updatesGenerated", async ({ timestamp }) => {
      try {
        const block = await client.anvil.evmMineDetailed(timestamp);
        logger.debug({ tag: "timing" }, `new block ts: ${formatTs(block)}`);
      } catch {}
    });
    const mcs = new Set(
      sdk.marketRegister.marketConfigurators.map(mc => mc.address),
    );
    // load second time with hook
    await sdk.marketRegister.loadMarkets(Array.from(mcs));
  }
  const service = createCreditAccountService(sdk, 310, {
    batchSize: config.compressorBatchSize,
  });

  return service;
}
