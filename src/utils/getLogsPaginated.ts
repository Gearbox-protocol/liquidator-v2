import type { AbiEvent } from "abitype";
import type {
  BlockNumber,
  Chain,
  Client,
  GetLogsParameters,
  GetLogsReturnType,
  MaybeAbiEventName,
  Transport,
} from "viem";
import { getLogs } from "viem/actions";

export type GetLogsPaginatedParameters<
  abiEvent extends AbiEvent | undefined = undefined,
  abiEvents extends
    | readonly AbiEvent[]
    | readonly unknown[]
    | undefined = abiEvent extends AbiEvent ? [abiEvent] : undefined,
  strict extends boolean | undefined = undefined,
  //
  _eventName extends string | undefined = MaybeAbiEventName<abiEvent>,
> = GetLogsParameters<
  abiEvent,
  abiEvents,
  strict,
  BlockNumber,
  BlockNumber,
  _eventName
> & {
  pageSize: bigint;
};

/**
 * Get logs in pages, to avoid rate limiting
 * Must be used with client that has batching enabled
 * @param client
 * @param params
 * @returns
 */
export async function getLogsPaginated<
  chain extends Chain | undefined,
  const abiEvent extends AbiEvent | undefined = undefined,
  const abiEvents extends
    | readonly AbiEvent[]
    | readonly unknown[]
    | undefined = abiEvent extends AbiEvent ? [abiEvent] : undefined,
  strict extends boolean | undefined = undefined,
>(
  client: Client<Transport, chain>,
  params: GetLogsPaginatedParameters<abiEvent, abiEvents, strict>,
): Promise<
  GetLogsReturnType<abiEvent, abiEvents, strict, BlockNumber, BlockNumber>
> {
  const from_ = params.fromBlock as bigint;
  const to_ = params.toBlock as bigint;
  const pageSize = params.pageSize;
  const requests: GetLogsParameters<
    abiEvent,
    abiEvents,
    strict,
    BlockNumber,
    BlockNumber
  >[] = [];
  for (let fromBlock = from_; fromBlock < to_; fromBlock += pageSize) {
    let toBlock = fromBlock + pageSize - 1n;
    if (toBlock > to_) {
      toBlock = to_;
    }
    requests.push({
      ...params,
      fromBlock,
      toBlock,
    } as GetLogsParameters<
      abiEvent,
      abiEvents,
      strict,
      BlockNumber,
      BlockNumber
    >);
  }
  const responses = await Promise.all(
    requests.map(r =>
      getLogs<chain, abiEvent, abiEvents, strict, BlockNumber, BlockNumber>(
        client,
        r,
      ),
    ),
  );

  return responses.flat().sort((a, b) => {
    if (a.blockNumber === b.blockNumber) {
      return a.logIndex - b.logIndex;
    } else if (a.blockNumber < b.blockNumber) {
      return -1;
    } else {
      return 1;
    }
  });
}
