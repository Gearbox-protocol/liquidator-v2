import { setTimeout } from "node:timers/promises";

export interface RetryOptions {
  attempts?: number;
  interval?: number;
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { attempts = 3, interval = 200 } = options;
  let cause: any;
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await fn();
      return result;
    } catch (e) {
      cause = e;
      await setTimeout(interval);
    }
  }
  throw new Error("all attempts failed", { cause });
}
