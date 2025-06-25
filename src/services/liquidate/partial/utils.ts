import type { CreditSuite, OnDemandPriceUpdate } from "@gearbox-protocol/sdk";
import { formatBN } from "@gearbox-protocol/sdk";
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
  priceUpdates: Partial<OnDemandPriceUpdate>[],
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
      if (p.token) {
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
