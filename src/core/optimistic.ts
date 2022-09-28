import { MultiCall } from "@gearbox-protocol/sdk";

export interface OptimisticResult {
  // Credit Manager address
  creditManager: string;

  // Borrower address
  borrower: string;

  // Gas used for liquidation from tx recepit
  gasUsed: number;

  // Multicalls used as parameter in liquidateCreditAccount function
  calls: Array<MultiCall>;

  // Estimated amount which was computed in pathfinder
  pathAmount: string;

  // How much tokens liquidator got on its account for the liquidation
  // liquidatorPremium = underlyingBalanceAfterLiquidation - underlyingBalanceBeforeLiquidation
  liquidatorPremium: string;

  // True if errors accrued
  isError: boolean;
}
