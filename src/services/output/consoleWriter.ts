import { OptimisticResult } from "../../core/optimistic";
import { IOptimisticOutputWriter } from "./types";

export default class ConsoleWriter implements IOptimisticOutputWriter {
  public async write(
    startBlock: number,
    result: OptimisticResult[],
  ): Promise<void> {
    console.info({ startBlock, result });
  }
}
