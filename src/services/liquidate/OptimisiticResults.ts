import type { OptimisticResult } from "@gearbox-protocol/types/optimist";

import { DI } from "../../di.js";

@DI.Injectable(DI.OptimisticResults)
export class OptimisticResults {
  #results: OptimisticResult[] = [];

  public push(result: OptimisticResult): void {
    this.#results.push(result);
  }

  public get(): OptimisticResult[] {
    return this.#results;
  }
}
