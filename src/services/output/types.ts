export interface IOptimisticOutputWriter {
  write: (prefix: number | bigint | string, result: unknown) => Promise<void>;
}
