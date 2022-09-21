import { MultiCall } from "@gearbox-protocol/sdk";

export interface OptimisticResult {
  creditManager: string;
  borrower: string;
  gasUsed: number;
  calls: Array<MultiCall>;
  pathAmount: string;
  remainingFunds: string;
  isError: boolean;
}
