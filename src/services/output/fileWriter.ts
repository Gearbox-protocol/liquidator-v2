import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { json_stringify } from "../../utils/index.js";
import BaseWriter from "./BaseWriter.js";
import type { IOptimisticOutputWriter } from "./types.js";

export default class FileWriter
  extends BaseWriter
  implements IOptimisticOutputWriter
{
  public async write(prefix: number | string, result: unknown): Promise<void> {
    const filename = join(this.config.outDir, this.getFilename(prefix));
    try {
      await writeFile(filename, json_stringify(result), "utf-8");
    } catch (e) {
      console.error(e);
    }
  }
}
