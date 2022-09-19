import { MultiCall } from "@gearbox-protocol/sdk";

export interface OptimisticResult {
  creditManager: string;
  borrower: string;
  gasUsed: number;
  calls: Array<MultiCall>;
  isError: boolean;
}
