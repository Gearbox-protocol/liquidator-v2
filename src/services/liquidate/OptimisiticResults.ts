import { Service } from "typedi";

import type { OptimisticResult } from "../../core/optimistic";

@Service()
export class OptimisticResults {
  #results: OptimisticResult[] = [];

  public push(result: OptimisticResult): void {
    this.#results.push(result);
  }

  public get(): OptimisticResult[] {
    return this.#results;
  }
}
