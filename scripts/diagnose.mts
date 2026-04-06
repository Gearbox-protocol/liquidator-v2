import {
  addressLike,
  Zommand,
  zommandRegistry,
} from "@gearbox-protocol/cli-utils";
import {
  AP_CREDIT_ACCOUNT_COMPRESSOR,
  createCreditAccountService,
  detectNetwork,
  GearboxSDK,
  VERSION_RANGE_310,
} from "@gearbox-protocol/sdk";
import {
  iCreditManagerV310Abi,
  iPoolV310Abi,
} from "@gearbox-protocol/sdk/abi/310/generated";
import type { Address } from "viem";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  multicall3Abi,
  parseAbi,
} from "viem";
import { z } from "zod/v4";

const c = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  redBold: (s: string) => `\x1b[1;31m${s}\x1b[0m`,
  greenBold: (s: string) => `\x1b[1;32m${s}\x1b[0m`,
  cyanBold: (s: string) => `\x1b[1;36m${s}\x1b[0m`,
  yellowBold: (s: string) => `\x1b[1;33m${s}\x1b[0m`,
};

const DiagnoseSchema = z.object({
  rpcUrl: z.string().register(zommandRegistry, {
    flags: "--rpc-url <url>",
    description: "RPC URL to use",
  }),
  block: z.coerce.bigint().register(zommandRegistry, {
    flags: "--block <number>",
    description: "Block number to query at",
  }),
  account: addressLike().register(zommandRegistry, {
    flags: "--account <address>",
    description: "Credit account address",
  }),
});

function formatTimestamp(ts: bigint): string {
  const date = new Date(Number(ts) * 1000);
  return `${date.toISOString()} (${ts})`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

interface PriceFeedInfo {
  address: Address;
  priceFeedType: string;
  description?: string;
  answer: { price: bigint; updatedAt: bigint; success: boolean };
  stalenessPeriod: number;
  underlyingFeeds: PriceFeedInfo[];
}

interface PriceFeedLike {
  priceFeedType: string;
  description?: string;
  answer: { price: bigint; updatedAt: bigint; success: boolean };
  underlyingPriceFeeds: readonly PriceFeedRefLike[];
}

interface PriceFeedRefLike {
  address: Address;
  stalenessPeriod: number;
  priceFeed: PriceFeedLike;
}

function collectFeedInfo(ref: PriceFeedRefLike): PriceFeedInfo {
  const pf = ref.priceFeed;
  return {
    address: ref.address,
    priceFeedType: pf.priceFeedType,
    description: pf.description,
    answer: pf.answer,
    stalenessPeriod: ref.stalenessPeriod,
    underlyingFeeds: pf.underlyingPriceFeeds.map(u => collectFeedInfo(u)),
  };
}

function printFeedInfo(
  info: PriceFeedInfo,
  blockTimestamp: bigint,
  indent: string,
): void {
  const age = blockTimestamp - info.answer.updatedAt;
  const isStale = Number(age) > info.stalenessPeriod;
  const staleTag = isStale ? ` ${c.redBold("⚠ STALE")}` : "";
  const successTag = info.answer.success ? c.green("OK") : c.redBold("FAILED");

  console.log(`${indent}Feed: ${c.dim(info.address)}`);
  console.log(`${indent}  Type: ${info.priceFeedType}`);
  if (info.description) {
    console.log(`${indent}  Description: ${info.description}`);
  }
  console.log(`${indent}  Price: ${info.answer.price}`);
  console.log(
    `${indent}  Updated at: ${formatTimestamp(info.answer.updatedAt)}`,
  );
  console.log(`${indent}  Success: ${successTag}`);
  console.log(
    `${indent}  Staleness period: ${formatDuration(info.stalenessPeriod)} ${c.dim(`(${info.stalenessPeriod}s)`)}`,
  );
  const ageColor = isStale ? c.red : (s: string) => s;
  console.log(
    `${indent}  Age: ${ageColor(formatDuration(Number(age)))} ${c.dim(`(${age}s)`)}${staleTag}`,
  );

  if (info.underlyingFeeds.length > 0) {
    console.log(`${indent}  Underlying feeds:`);
    for (const sub of info.underlyingFeeds) {
      printFeedInfo(sub, blockTimestamp, `${indent}    `);
    }
  }
}

const compressorGetAccountAbi = parseAbi([
  "function getCreditAccountData(address creditAccount) view returns (bytes)",
]);

const multicallTimestampAbi = parseAbi([
  "function getCurrentBlockTimestamp() public view returns (uint256 timestamp)",
  "function getBlockNumber() public view returns (uint256 blockNumber)",
]);

const MULTICALL3_ADDRESS: Address =
  "0xcA11bde05977b3631167028862bE2a173976CA11";

const program = new Zommand("diagnose", {
  schema: DiagnoseSchema,
  templateData: { ...process.env },
})
  .description("Diagnose credit account health factor issues")
  .action(async schema => {
    const { rpcUrl, block, account } = schema;
    const transport = http(rpcUrl);
    const client = createPublicClient({ transport });
    const network = await detectNetwork(client);
    const creditManager = await client.readContract({
      address: account,
      abi: parseAbi(["function creditManager() view returns (address)"]),
      functionName: "creditManager",
      blockNumber: block,
    });
    const pool = await client.readContract({
      address: creditManager,
      abi: iCreditManagerV310Abi,
      functionName: "pool",
      blockNumber: block,
    });
    const acl = await client.readContract({
      address: pool,
      abi: iPoolV310Abi,
      functionName: "acl",
      blockNumber: block,
    });
    const marketConfigurator = await client.readContract({
      address: acl,
      abi: parseAbi(["function getConfigurator() view returns (address)"]),
      functionName: "getConfigurator",
      blockNumber: block,
    });

    console.log(`${c.bold("Network:")} ${network}`);
    console.log(`${c.bold("Market configurator:")} ${marketConfigurator}`);
    console.log(`${c.bold("Block:")} ${block}`);
    console.log(`${c.bold("Account:")} ${account}`);
    console.log();

    console.log(c.dim("Attaching SDK..."));
    const sdk = await GearboxSDK.attach({
      transport,
      networkType: network,
      marketConfigurators: [marketConfigurator],
      ignoreUpdateablePrices: false,
      pyth: {
        historicTimestamp: true,
      },
      redstone: {
        historicTimestamp: true,
      },
      blockNumber: block,
    });
    console.log(
      `${c.bold("Block timestamp:")} ${formatTimestamp(sdk.timestamp)}`,
    );

    const service = createCreditAccountService(sdk, 310);

    console.log(c.dim("Fetching credit account data..."));
    const ca = await service.getCreditAccountData(getAddress(account), block);

    if (!ca) {
      console.error(c.redBold("✗ Credit account not found"));
      process.exit(1);
    }

    const hfColor = ca.healthFactor === 0n || !ca.success ? c.red : c.green;
    console.log();
    console.log(
      `${c.bold("Health factor:")} ${hfColor(ca.healthFactor.toString())}`,
    );
    console.log(
      `${c.bold("Success:")} ${ca.success ? c.green("true") : c.red("false")}`,
    );
    console.log();

    if (ca.healthFactor !== 0n && ca.success) {
      console.log(
        c.greenBold("✓ Account is healthy") +
          c.dim(" (HF != 0 and success = true). Nothing to diagnose."),
      );
      process.exit(0);
    }

    console.log(c.cyanBold("🔍 DIAGNOSING PRICE FEEDS"));
    console.log();

    const market = sdk.marketRegister.findByCreditManager(ca.creditManager);
    const oracle = market.priceOracle;

    const tokensWithBalance = ca.tokens
      .filter(t => t.balance > BigInt(10))
      .map(t => getAddress(t.token));

    for (const token of tokensWithBalance) {
      const symbol = sdk.tokensMeta.symbol(token);
      console.log(c.bold(`--- Token: ${symbol} (${token}) ---`));

      const mainRef = oracle.mainPriceFeeds.get(token);
      if (mainRef) {
        console.log(`  ${c.cyan("[MAIN]")}`);
        const info = collectFeedInfo(mainRef);
        printFeedInfo(info, sdk.timestamp, "  ");
      }

      const reserveRef = oracle.reservePriceFeeds.get(token);
      if (reserveRef) {
        console.log(`  ${c.cyan("[RESERVE]")}`);
        const info = collectFeedInfo(reserveRef);
        printFeedInfo(info, sdk.timestamp, "  ");
      }

      if (!mainRef && !reserveRef) {
        console.log(c.yellow("  No price feeds found for this token"));
      }

      console.log();
    }

    console.log(c.cyanBold("📋 CAST CALL TRACE COMMAND"));
    console.log();

    try {
      const { txs: priceUpdateTxs } =
        await sdk.priceFeeds.generatePriceFeedsUpdateTxs(
          oracle.priceFeedsForTokens(tokensWithBalance),
        );

      const [compressorAddress] = sdk.addressProvider.mustGetLatest(
        AP_CREDIT_ACCOUNT_COMPRESSOR,
        VERSION_RANGE_310,
      );

      const calls: {
        allowFailure: boolean;
        callData: `0x${string}`;
        target: Address;
      }[] = [];

      // Timestamp call
      calls.push({
        allowFailure: true,
        callData: encodeFunctionData({
          abi: multicallTimestampAbi,
          functionName: "getCurrentBlockTimestamp",
          args: [],
        }),
        target: MULTICALL3_ADDRESS,
      });

      // Block number call
      calls.push({
        allowFailure: true,
        callData: encodeFunctionData({
          abi: multicallTimestampAbi,
          functionName: "getBlockNumber",
          args: [],
        }),
        target: MULTICALL3_ADDRESS,
      });

      // Price update calls
      for (const tx of priceUpdateTxs) {
        calls.push({
          allowFailure: true,
          callData: tx.raw.callData,
          target: tx.raw.to,
        });
      }

      // getCreditAccountData call
      calls.push({
        allowFailure: true,
        callData: encodeFunctionData({
          abi: compressorGetAccountAbi,
          functionName: "getCreditAccountData",
          args: [getAddress(account)],
        }),
        target: compressorAddress,
      });

      const multicallData = encodeFunctionData({
        abi: multicall3Abi,
        functionName: "aggregate3",
        args: [calls],
      });

      const cmd = [
        "cast",
        "call",
        "--rpc-url",
        "$RPC_URL",
        "--trace",
        "--block",
        block.toString(),
        MULTICALL3_ADDRESS,
        multicallData,
      ];

      console.log(cmd.join(" \\\n  "));
    } catch (e) {
      console.error(c.red("✗ Failed to generate cast command:"), e);
    }

    process.exit(0);
  });

program.parseAsync().catch(e => {
  console.error(c.redBold("✗ Fatal error:"), e);
  process.exit(1);
});
