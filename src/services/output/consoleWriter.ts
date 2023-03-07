import { OptimisticResult } from "../../core/optimistic";
import { IOptimisticOutputWriter } from "./types";

export default class ConsoleWriter implements IOptimisticOutputWriter {
  public async write(result: OptimisticResult[]): Promise<void> {
    console.info({ result });
  }
}
