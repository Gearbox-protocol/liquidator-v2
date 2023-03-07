import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import config from "../../config";
import { OptimisticResult } from "../../core/optimistic";
import getFilename from "./filename";
import { IOptimisticOutputWriter } from "./types";

export default class FileWriter implements IOptimisticOutputWriter {
  public async write(result: OptimisticResult[]): Promise<void> {
    const filename = join(config.outDir ?? "", getFilename());
    try {
      await writeFile(
        filename,
        JSON.stringify({ startBlock: config.optimisticForkHead, result }),
        "utf-8",
      );
    } catch (e) {
      console.error(e);
    }
  }
}
