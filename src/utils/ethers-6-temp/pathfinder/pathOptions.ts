import type {
  AuraLPToken,
  AuraStakedToken,
  BalancerLPToken,
  ConvexLPToken,
  CurveLPToken,
  CurveParams,
  NetworkType,
  YearnLPToken,
} from "@gearbox-protocol/sdk-gov";
import {
  auraTokens,
  balancerLpTokens,
  contractParams,
  convexTokens,
  curveTokens,
  isBalancerLPToken,
  isCurveLPToken,
  toBigInt,
  tokenDataByNetwork,
  tokenSymbolByAddress,
  yearnTokens,
} from "@gearbox-protocol/sdk-gov";
import type { Address } from "viem";

import type { TokenBalance } from "../../../data/index.js";

export interface PathOption {
  target: Address;
  option: number;
  totalOptions: number;
}

export type PathOptionSerie = PathOption[];

export class PathOptionFactory {
  static generatePathOptions(
    balances: Array<Pick<TokenBalance, "token" | "balance">>,
    loopsInTx: number,
    network: NetworkType,
  ): Array<PathOptionSerie> {
    const curvePools = PathOptionFactory.getCurvePools(balances);
    const balancerPools = PathOptionFactory.getBalancerPools(balances);

    const curveInitPO: PathOptionSerie = curvePools.map(symbol => {
      return {
        target: tokenDataByNetwork[network][symbol],
        option: 0,
        totalOptions: (contractParams[curveTokens[symbol].pool] as CurveParams)
          .tokens.length,
      };
    });
    const balancerInitPO: PathOptionSerie = balancerPools.map(symbol => {
      return {
        target: tokenDataByNetwork[network][symbol],
        option: 0,
        totalOptions: balancerLpTokens[symbol].underlying.length,
      };
    });
    const initPO = [...curveInitPO, ...balancerInitPO];

    const totalLoops = initPO.reduce<number>(
      (acc, item) => acc * item.totalOptions,
      1,
    );

    const result: Array<PathOptionSerie> = [];

    let currentPo = [...initPO];

    for (let i = 0; i < totalLoops; i++) {
      if (i % loopsInTx === 0) {
        result.push(currentPo);
      }
      if (i < totalLoops - 1) {
        currentPo = PathOptionFactory.next(currentPo);
      }
    }

    return result;
  }

  static getCurvePools(
    balances: Array<Pick<TokenBalance, "token" | "balance">>,
  ): Array<CurveLPToken> {
    const nonZeroBalances = balances.filter(b => toBigInt(b.balance) > 1);

    const curvePools = nonZeroBalances
      .map(b => tokenSymbolByAddress[b.token.toLowerCase()])
      .filter(symbol => isCurveLPToken(symbol)) as Array<CurveLPToken>;

    const yearnCurveTokens = Object.entries(yearnTokens)
      .filter(([, data]) => isCurveLPToken(data.underlying))
      .map(([token]) => token);

    const curvePoolsFromYearn = nonZeroBalances
      .map(b => tokenSymbolByAddress[b.token.toLowerCase()])
      .filter(symbol => yearnCurveTokens.includes(symbol))
      .map(
        symbol => yearnTokens[symbol as YearnLPToken].underlying,
      ) as Array<CurveLPToken>;

    const convexCurveTokens = Object.entries(convexTokens)
      .filter(([, data]) => isCurveLPToken(data.underlying))
      .map(([token]) => token);

    const curvePoolsFromConvex = nonZeroBalances
      .map(b => tokenSymbolByAddress[b.token.toLowerCase()])
      .filter(symbol => convexCurveTokens.includes(symbol))
      .map(symbol => convexTokens[symbol as ConvexLPToken].underlying);

    const curveSet = new Set([
      ...curvePools,
      ...curvePoolsFromYearn,
      ...curvePoolsFromConvex,
    ]);
    return Array.from(curveSet.values());
  }

  static getBalancerPools(
    balances: Array<Pick<TokenBalance, "token" | "balance">>,
  ): Array<BalancerLPToken> {
    const nonZeroBalances = balances.filter(b => toBigInt(b.balance) > 1);

    const balancerPools = nonZeroBalances
      .map(b => tokenSymbolByAddress[b.token.toLowerCase()])
      .filter(symbol => isBalancerLPToken(symbol)) as Array<BalancerLPToken>;

    const balancerAuraTokens = Object.entries(auraTokens)
      .filter(([, data]) => isBalancerLPToken(data.underlying))
      .map(([token]) => token);

    const balancerTokensFromAura = nonZeroBalances
      .map(b => tokenSymbolByAddress[b.token.toLowerCase()])
      .filter(symbol => balancerAuraTokens.includes(symbol))
      .map(
        symbol =>
          auraTokens[symbol as AuraLPToken | AuraStakedToken].underlying,
      );

    const balancerSet = new Set([...balancerPools, ...balancerTokensFromAura]);

    return Array.from(balancerSet.values());
  }

  static next(path: PathOptionSerie): PathOptionSerie {
    let newPath = [...path];
    for (let i = path.length - 1; i >= 0; i--) {
      const po = { ...newPath[i] };
      po.option++;
      newPath[i] = po;

      if (po.option < po.totalOptions) return newPath;
      po.option = 0;
    }

    throw new Error("Path options overflow");
  }
}
