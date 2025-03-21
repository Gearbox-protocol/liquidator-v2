import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import BaseWriter from "./BaseWriter.js";
import type { IOptimisticOutputWriter } from "./types.js";

export default class FileWriter
  extends BaseWriter
  implements IOptimisticOutputWriter
{
  public async write(): Promise<void> {
    const filename = join(this.config.outDir, this.filename);
    try {
      this.log.debug(`writing to ${filename}`);
      await writeFile(filename, this.content, "utf-8");
    } catch (e) {
      this.log.error(e, `failed to write to ${filename}`);
    }
  }
}
