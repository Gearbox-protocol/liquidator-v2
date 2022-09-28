import { OptimisticResult } from "../../core/optimistic";

export interface IOptimisticOutputWriter {
  write: (startBlock: number, result: OptimisticResult[]) => Promise<void>;
}
