import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import { getConnectors } from "@gearbox-protocol/sdk-gov";
import type {
  Balance,
  IRouterV3,
  RouterResult,
} from "@gearbox-protocol/types/v3";
import { IRouterV3__factory } from "@gearbox-protocol/types/v3";
import type { Provider, Signer } from "ethers";

import type { CreditAccountData } from "../CreditAccountData";
import type { CreditManagerData } from "../CreditManagerData";
import type { PathFinderCloseResult, PathFinderResult } from "./core";
import { PathOptionFactory } from "./pathOptions";

const MAX_GAS_PER_ROUTE = 200e6;
const GAS_PER_BLOCK = 400e6;

interface FindBestClosePathProps {
  creditAccount: CreditAccountData;
  creditManager: CreditManagerData;
  expectedBalances: Record<string, Balance>;
  leftoverBalances: Record<string, Balance>;
  slippage: number;
  noConcurrency?: boolean;
  network: NetworkType;
}

export class PathFinder {
  pathFinder: IRouterV3;
  network: NetworkType;

  protected readonly _connectors: Array<string>;

  constructor(
    address: string,
    provider: Signer | Provider,
    network: NetworkType = "Mainnet",
  ) {
    this.pathFinder = IRouterV3__factory.connect(address, provider);
    this.network = network;

    this._connectors = getConnectors(network);
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
    noConcurrency = false,
    network,
  }: FindBestClosePathProps): Promise<PathFinderCloseResult> {
    const loopsPerTx = Math.floor(GAS_PER_BLOCK / MAX_GAS_PER_ROUTE);
    const pathOptions = PathOptionFactory.generatePathOptions(
      creditAccount.allBalances,
      loopsPerTx,
      network,
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
    if (noConcurrency) {
      for (const po of pathOptions) {
        results.push(
          await this.pathFinder.findBestClosePath.staticCall(
            creditAccount.addr,
            expected,
            leftover,
            connectors,
            slippage,
            po,
            loopsPerTx,
            false,
            {
              gasLimit: GAS_PER_BLOCK,
            },
          ),
        );
      }
    } else {
      const requests = pathOptions.map(po =>
        this.pathFinder.findBestClosePath.staticCall(
          creditAccount.addr,
          expected,
          leftover,
          connectors,
          slippage,
          po,
          loopsPerTx,
          false,
          {
            gasLimit: GAS_PER_BLOCK,
          },
        ),
      );
      results = await Promise.all(requests);
    }

    const bestResult = results.reduce<PathFinderResult>(
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
        creditAccount.allBalances[creditAccount.underlyingToken.toLowerCase()]
          .balance,
    };
  }

  static compare(r1: PathFinderResult, r2: PathFinderResult): PathFinderResult {
    return r1.amount > r2.amount ? r1 : r2;
  }

  getAvailableConnectors(availableList: Record<string, any>) {
    const connectors = PathFinder.getAvailableConnectors(
      availableList,
      this._connectors,
    );
    return connectors;
  }

  static getAvailableConnectors(
    availableList: Record<string, any>,
    connectors: string[],
  ) {
    return connectors.filter(t => availableList[t] !== undefined);
  }
}
