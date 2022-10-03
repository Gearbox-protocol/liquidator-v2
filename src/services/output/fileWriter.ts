import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import config from "../../config";
import { OptimisticResult } from "../../core/optimistic";
import { IOptimisticOutputWriter } from "./types";

export default class FileWriter implements IOptimisticOutputWriter {
  public async write(
    startBlock: number,
    result: OptimisticResult[],
  ): Promise<void> {
    const filename = join(
      config.outDir ?? "",
      `${startBlock}-${config.outSuffix.replaceAll("-", "")}.json`,
    );
    try {
      await writeFile(
        filename,
        JSON.stringify({ startBlock, result }),
        "utf-8",
      );
    } catch (e) {
      console.error(e);
    }
  }
}
