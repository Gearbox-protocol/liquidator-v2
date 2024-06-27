export interface IOptimisticOutputWriter {
  write: () => Promise<void>;
}
