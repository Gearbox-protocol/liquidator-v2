import { chains, OnchainSDK } from "@gearbox-protocol/sdk/onchain";
import { AccountsPlugin } from "@gearbox-protocol/sdk/plugins/accounts";

import type { Config } from "./config";
import DI from "./di";
import { waitForBlockNumber } from "./utils";

export default async function injectSDK(config: Config): Promise<void> {
  const logger = DI.create(DI.Logger, "SDK");
  let blockNumber: bigint;
  // Possible to pin block number via env var to reproduce locally
  if (config.blockNumber) {
    blockNumber = config.blockNumber;
  } else {
    blockNumber = await waitForBlockNumber(config.originRPC.value);
    let blockOffset = 0n;
    if (config.blockOffset) {
      blockOffset = config.blockOffset;
    } else if (config.timeOffset) {
      const blockTime = chains[config.network].blockTime;
      if (!blockTime) {
        throw new Error(`Block time not found for network ${config.network}`);
      }
      blockOffset = BigInt(Math.ceil((config.timeOffset * 1000) / blockTime));
      logger.info(
        { blockOffset, timeOffset: config.timeOffset },
        "using time offset to calculate block offset",
      );
    }
    blockNumber -= blockOffset;
  }

  let gasLimit: bigint | undefined | null = config.gasLimit;
  if (config.gasLimit === -1n) {
    gasLimit = null;
  }

  const sdk = new OnchainSDK(
    config.network,
    {
      rpcURLs: [config.originRPC.value],
      timeout: 240_000,
    },
    {
      logger,
      plugins: {
        accounts: new AccountsPlugin({}, true),
      },
      gasLimit,
    },
  );
  await sdk.attach({
    addressProvider: config.addressProvider,
    marketConfigurators: config.marketConfigurators,
    rwaFactories: config.rwaFactories,
    blockNumber,
    redstone: {
      historicTimestamp: true,
    },
  });

  DI.set(DI.SDK, sdk);
}
