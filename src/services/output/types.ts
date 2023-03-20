export interface IOptimisticOutputWriter {
  write: (prefix: number | string, result: unknown) => Promise<void>;
}
