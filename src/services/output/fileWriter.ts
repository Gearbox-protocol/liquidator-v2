import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import config from "../../config";
import { json_stringify } from "../utils";
import getFilename from "./filename";
import type { IOptimisticOutputWriter } from "./types";

export default class FileWriter implements IOptimisticOutputWriter {
  public async write(prefix: number | string, result: unknown): Promise<void> {
    const filename = join(config.outDir ?? "", getFilename(prefix));
    try {
      await writeFile(filename, json_stringify(result), "utf-8");
    } catch (e) {
      console.error(e);
    }
  }
}
