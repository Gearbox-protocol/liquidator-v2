import type {
  CreditSuite,
  Curator,
  OnDemandPriceUpdates,
  PriceUpdateV300,
  PriceUpdateV310,
} from "@gearbox-protocol/sdk";
import { formatBN, getCuratorName } from "@gearbox-protocol/sdk";
import type { Address } from "abitype";

import type { OptimalPartialLiquidation } from "./types.js";

export function humanizeOptimalLiquidation(
  cm: CreditSuite,
  data: OptimalPartialLiquidation,
): Record<string, any> {
  const [symb, decimals, uSymb, uDec] = [
    cm.sdk.tokensMeta.symbol(data.tokenOut),
    cm.sdk.tokensMeta.decimals(data.tokenOut),
    cm.sdk.tokensMeta.symbol(cm.underlying),
    cm.sdk.tokensMeta.decimals(cm.underlying),
  ];
  return {
    tokenOut: `${symb} (${data.tokenOut})`,
    optimalAmount:
      formatBN(data.optimalAmount, decimals) +
      ` ${symb} (${data.optimalAmount})`,
    flashLoanAmount:
      formatBN(data.flashLoanAmount, uDec) +
      ` ${uSymb} (${data.flashLoanAmount})`,
    repaidAmount: `${formatBN(data.repaidAmount, uDec)} ${uSymb} (${data.repaidAmount})`,
    isOptimalRepayable: data.isOptimalRepayable,
  };
}

export function humanizePreviewPartialLiquidation(
  cm: CreditSuite,
  data: OptimalPartialLiquidation,
  priceUpdates: OnDemandPriceUpdates,
  slippage: number,
  liquidatorContract: Address,
  connectors?: Address[],
): Record<string, any> {
  const result = humanizeOptimalLiquidation(cm, data);
  return {
    ...result,
    liquidatorContract,
    connectors,
    priceUpdates: (
      priceUpdates.raw as Array<PriceUpdateV300 | PriceUpdateV310>
    ).map(p => {
      if ("token" in p) {
        return p.token;
      }
      if (p.priceFeed) {
        return p.priceFeed;
      }
      return "-";
    }),
    slippage: slippage.toString(),
  };
}

export function mustGetCuratorName(cm: CreditSuite): Curator {
  const curator = getCuratorName(cm.marketConfigurator, cm.networkType);
  if (!curator) {
    throw new Error(
      `unknown market configurator ${cm.marketConfigurator} on ${cm.networkType}`,
    );
  }
  return curator;
}
