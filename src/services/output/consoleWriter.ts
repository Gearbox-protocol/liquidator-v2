import { IOptimisticOutputWriter } from "./types";

export default class ConsoleWriter implements IOptimisticOutputWriter {
  public async write(prefix: string | number, result: unknown): Promise<void> {
    console.info(JSON.stringify(result));
  }
}
