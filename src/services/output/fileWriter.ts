import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import config from "../../config";
import getFilename from "./filename";
import { IOptimisticOutputWriter } from "./types";

export default class FileWriter implements IOptimisticOutputWriter {
  public async write(prefix: number | string, result: unknown): Promise<void> {
    const filename = join(config.outDir ?? "", getFilename(prefix));
    try {
      await writeFile(filename, JSON.stringify(result), "utf-8");
    } catch (e) {
      console.error(e);
    }
  }
}
