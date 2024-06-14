import { json_stringify } from "../../utils/index.js";
import type { IOptimisticOutputWriter } from "./types.js";

export default class ConsoleWriter implements IOptimisticOutputWriter {
  public async write(
    prefix: string | bigint | number,
    result: unknown,
  ): Promise<void> {
    console.info(json_stringify(result));
  }
}
