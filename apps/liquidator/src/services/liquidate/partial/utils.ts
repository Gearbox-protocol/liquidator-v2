import type { CuratorName } from "@gearbox-protocol/sdk/model";
import type { CreditSuite, PriceUpdate } from "@gearbox-protocol/sdk/onchain";
import { formatBN, getCuratorName } from "@gearbox-protocol/sdk/onchain";
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
  priceUpdates: PriceUpdate[],
  slippage: number,
  liquidatorContract: Address,
  connectors?: Address[],
): Record<string, any> {
  const result = humanizeOptimalLiquidation(cm, data);
  return {
    ...result,
    liquidatorContract,
    connectors,
    priceUpdates: priceUpdates.map(p => {
      if (p.priceFeed) {
        return p.priceFeed;
      }
      return "-";
    }),
    slippage: slippage.toString(),
  };
}

export function mustGetCuratorName(cm: CreditSuite): CuratorName {
  const curator = getCuratorName(cm.marketConfigurator.address, cm.networkType);
  if (!curator) {
    throw new Error(
      `unknown market configurator ${cm.marketConfigurator.address} on ${cm.networkType}`,
    );
  }
  return curator;
}
