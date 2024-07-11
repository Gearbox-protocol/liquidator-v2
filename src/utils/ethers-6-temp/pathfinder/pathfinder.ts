import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import { getConnectors, getDecimals } from "@gearbox-protocol/sdk-gov";
import { iRouterV3Abi } from "@gearbox-protocol/types/abi";
import { type Address, getContract, type PublicClient } from "viem";

import type {
  Balance,
  CreditAccountData,
  CreditManagerData,
} from "../../../data/index.js";
import type { EstimateBatchInput, PathFinderCloseResult } from "./core.js";
import { PathOptionFactory } from "./pathOptions.js";
import type { IRouterV3Contract, RouterResult } from "./viem-types.js";

const MAX_GAS_PER_ROUTE = 200_000_000n;
const GAS_PER_BLOCK = 400_000_000n;
const LOOPS_PER_TX = Number(GAS_PER_BLOCK / MAX_GAS_PER_ROUTE);

interface FindBestClosePathProps {
  creditAccount: CreditAccountData;
  creditManager: CreditManagerData;
  expectedBalances: Record<Address, Balance>;
  leftoverBalances: Record<Address, Balance>;
  slippage: number;
}

export class PathFinder {
  readonly #pathFinder: IRouterV3Contract;
  readonly #connectors: Address[];
  readonly #network: NetworkType;

  constructor(address: Address, client: PublicClient, network: NetworkType) {
    this.#pathFinder = getContract({
      abi: iRouterV3Abi,
      address,
      client,
    });
    this.#network = network;
    this.#connectors = getConnectors(network);
  }

  /**
   * @dev Finds the path to swap / withdraw all assets from CreditAccount into underlying asset
   *   Can bu used for closing Credit Account and for liquidations as well.
   * @param creditAccount CreditAccountData object used for close path computation
   * @param slippage Slippage in PERCENTAGE_FORMAT (100% = 10_000) per operation
   * @return The best option in PathFinderCloseResult format, which
   *          - underlyingBalance - total balance of underlying token
   *          - calls - list of calls which should be done to swap & unwrap everything to underlying token
   */
  async findBestClosePath({
    creditAccount,
    creditManager: cm,
    expectedBalances,
    leftoverBalances,
    slippage,
  }: FindBestClosePathProps): Promise<PathFinderCloseResult> {
    const pathOptions = PathOptionFactory.generatePathOptions(
      creditAccount.allBalances,
      LOOPS_PER_TX,
      this.#network,
    );

    const expected: Balance[] = cm.collateralTokens.map(token => {
      // When we pass expected balances explicitly, we need to mimic router behaviour by filtering out leftover tokens
      // for example, we can have stETH balance of 2, because 1 transforms to 2 because of rebasing
      // https://github.com/Gearbox-protocol/router-v3/blob/c230a3aa568bb432e50463cfddc877fec8940cf5/contracts/RouterV3.sol#L222
      const actual = expectedBalances[token]?.balance || 0n;
      return {
        token,
        balance: actual > 10n ? actual : 0n,
      };
    });

    const leftover: Balance[] = cm.collateralTokens.map(token => ({
      token,
      balance: leftoverBalances[token]?.balance || 1n,
    }));

    const connectors = this.getAvailableConnectors(creditAccount.allBalances);
    let results: RouterResult[] = [];
    for (const po of pathOptions) {
      const { result } = await this.#pathFinder.simulate.findBestClosePath(
        [
          creditAccount.addr,
          expected,
          leftover,
          connectors,
          BigInt(slippage),
          po,
          BigInt(LOOPS_PER_TX),
          false,
        ],
        {
          gas: GAS_PER_BLOCK,
        },
      );
      results.push(result);
    }

    const bestResult = results.reduce(
      (best, pathFinderResult) => PathFinder.compare(best, pathFinderResult),
      {
        amount: 0n,
        minAmount: 0n,
        calls: [],
      },
    );

    return {
      amount: bestResult.amount,
      minAmount: bestResult.minAmount,
      calls: bestResult.calls.map(c => ({
        callData: c.callData,
        target: c.target,
      })),
      underlyingBalance:
        bestResult.minAmount +
        creditAccount.balances[
          creditAccount.underlyingToken.toLowerCase() as Address
        ],
    };
  }

  // TODO: readme
  getEstimateBatchInput(
    ca: CreditAccountData,
    slippage: number,
  ): EstimateBatchInput {
    const expectedBalances: Record<Address, Balance> = {};
    const leftoverBalances: Record<Address, Balance> = {};
    for (const { token, balance, isEnabled } of ca.allBalances) {
      expectedBalances[token] = { token, balance };
      // filter out dust, we don't want to swap it
      const minBalance = 10n ** BigInt(Math.max(8, getDecimals(token)) - 8);
      // also: gearbox liquidator does not need to swap disabled tokens. third-party liquidators might want to do it
      if (balance < minBalance || !isEnabled) {
        leftoverBalances[token] = { token, balance };
      }
    }
    const connectors = this.getAvailableConnectors(ca.allBalances);
    const pathOptions = PathOptionFactory.generatePathOptions(
      ca.allBalances,
      LOOPS_PER_TX,
      this.#network,
    );
    return {
      creditAccount: ca.addr,
      expectedBalances: Object.values(expectedBalances),
      leftoverBalances: Object.values(leftoverBalances),
      connectors,
      slippage: BigInt(slippage),
      pathOptions: pathOptions[0] ?? [], // TODO: what to put here?
      iterations: BigInt(LOOPS_PER_TX),
      force: false,
    };
  }

  static compare<T extends { amount: bigint }>(r1: T, r2: T): T {
    return r1.amount > r2.amount ? r1 : r2;
  }

  getAvailableConnectors(availableList: Array<{ token: Address }>) {
    const connectors = PathFinder.getAvailableConnectors(
      availableList,
      this.#connectors,
    );
    return connectors;
  }

  static getAvailableConnectors(
    availableList: Array<{ token: Address }>,
    connectors: Address[],
  ) {
    const available = new Set(
      availableList.map(t => t.token.toLowerCase() as Address),
    );
    return connectors.filter(t => available.has(t.toLowerCase() as Address));
  }
}
