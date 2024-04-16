import { json_stringify } from "../utils/bigint-serializer";
import type { IOptimisticOutputWriter } from "./types";

export default class ConsoleWriter implements IOptimisticOutputWriter {
  public async write(prefix: string | number, result: unknown): Promise<void> {
    console.info(json_stringify(result));
  }
}
