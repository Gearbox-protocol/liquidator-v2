import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import BaseWriter from "./BaseWriter";
import type { IOptimisticOutputWriter } from "./types";

export default class FileWriter
  extends BaseWriter
  implements IOptimisticOutputWriter
{
  public async write(prefix: number | string, result: unknown): Promise<void> {
    const filename = join(this.config.outDir, this.getFilename(prefix));
    try {
      await writeFile(filename, JSON.stringify(result), "utf-8");
    } catch (e) {
      console.error(e);
    }
  }
}
