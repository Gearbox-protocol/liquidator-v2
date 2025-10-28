import type { OptimisticResult } from "@gearbox-protocol/types/optimist";

import { DI } from "../../di.js";

@DI.Injectable(DI.OptimisticResults)
export class OptimisticResults {
  #results: OptimisticResult<bigint>[] = [];

  public push(result: OptimisticResult<bigint>): void {
    this.#results.push(result);
  }

  public get(): OptimisticResult<bigint>[] {
    return this.#results;
  }
}
