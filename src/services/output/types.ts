import { OptimisticResult } from "../../core/optimistic";

export interface IOptimisticOutputWriter {
  write: (result: OptimisticResult[]) => Promise<void>;
}
