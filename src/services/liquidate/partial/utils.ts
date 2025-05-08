import type { CreditSuite } from "@gearbox-protocol/sdk";
import { formatBN } from "@gearbox-protocol/sdk";

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
    repaidAmount:
      formatBN(data.repaidAmount, uDec) + ` ${uSymb} (${data.repaidAmount})`,
    isOptimalRepayable: data.isOptimalRepayable,
  };
}
