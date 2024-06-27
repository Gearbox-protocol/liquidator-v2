import BaseWriter from "./BaseWriter.js";
import type { IOptimisticOutputWriter } from "./types.js";

export default class ConsoleWriter
  extends BaseWriter
  implements IOptimisticOutputWriter
{
  public async write(): Promise<void> {
    console.info(this.content);
  }
}
