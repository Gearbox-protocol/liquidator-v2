import type { AbiEvent } from "abitype";
import {
  type BlockNumber,
  type Chain,
  type Client,
  type GetLogsParameters,
  type GetLogsReturnType,
  HttpRequestError,
  type Transport,
} from "viem";
import { getLogs } from "viem/actions";

interface BlockRange {
  fromBlock: bigint;
  toBlock: bigint;
}

export async function getLogsSafe<
  chain extends Chain | undefined,
  const abiEvent extends AbiEvent | undefined = undefined,
  const abiEvents extends
    | readonly AbiEvent[]
    | readonly unknown[]
    | undefined = abiEvent extends AbiEvent ? [abiEvent] : undefined,
  strict extends boolean | undefined = undefined,
>(
  client: Client<Transport, chain>,
  params: GetLogsParameters<
    abiEvent,
    abiEvents,
    strict,
    BlockNumber,
    BlockNumber
  > = {},
): Promise<
  GetLogsReturnType<abiEvent, abiEvents, strict, BlockNumber, BlockNumber>
> {
  try {
    const events = await getLogs<
      chain,
      abiEvent,
      abiEvents,
      strict,
      BlockNumber,
      BlockNumber
    >(client, params);
    return events;
  } catch (e) {
    const fromBlock = params.fromBlock as bigint;
    const toBlock = params.toBlock as bigint;
    const bisected = tryBisectBlockRange({ fromBlock, toBlock }, e);
    if (!bisected) {
      throw e;
    }

    const [left, right] = await Promise.all([
      getLogsSafe(client, { ...params, ...bisected[0] } as any),
      getLogsSafe(client, { ...params, ...bisected[1] } as any),
    ]);
    return [...left, ...right] as GetLogsReturnType<
      abiEvent,
      abiEvents,
      strict,
      BlockNumber,
      BlockNumber
    >;
  }
}

function tryBisectBlockRange(
  { fromBlock, toBlock }: BlockRange,
  e: any,
): [BlockRange, BlockRange] | undefined {
  const alchemyMid = checkForAlchemyBlockRange(e);
  if (alchemyMid && alchemyMid > fromBlock && alchemyMid < toBlock) {
    return [
      { fromBlock, toBlock: alchemyMid },
      { fromBlock: alchemyMid + 1n, toBlock },
    ];
  }

  const blockRangeErrors = [
    "query exceeds max block",
    "range is too large",
    "eth_getLogs is limited to",
    "eth_getLogs requests with up to",
  ];

  if (
    e instanceof Error &&
    blockRangeErrors.some(errorText => e.message.includes(errorText))
  ) {
    const middle = (fromBlock + toBlock) / 2n;
    return [
      { fromBlock, toBlock: middle },
      { fromBlock: middle + 1n, toBlock },
    ];
  }
  return undefined;
}

const ALCHEMY_BLOCK_RANGE_REGEX =
  /this block range should work: \[(0x[0-9a-fA-F]+),\s*(0x[0-9a-fA-F]+)\]/;

function checkForAlchemyBlockRange(e: any): bigint | undefined {
  if (e instanceof HttpRequestError) {
    try {
      // exmple of alchemy error:
      // Details: {"code":-32600,"message":"You can make eth_getLogs requests with up to a 10000 block range. Based on your parameters, this block range should work: [0x9538b4, 0x955fc3]"}
      const err = JSON.parse(e.details);
      if (typeof err.message === "string") {
        const match = err.message.match(ALCHEMY_BLOCK_RANGE_REGEX);
        if (match) {
          return BigInt(match[2]);
        }
      }
    } catch {}
  }
  return undefined;
}
