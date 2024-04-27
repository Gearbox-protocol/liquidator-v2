import { Service } from "typedi";

import type { OptimisticResultV2 } from "../../core/optimistic";

@Service()
export class OptimisticResults {
  #results: OptimisticResultV2[] = [];

  public push(result: OptimisticResultV2): void {
    this.#results.push(result);
  }

  public get(): OptimisticResultV2[] {
    return this.#results;
  }
}
