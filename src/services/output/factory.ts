import { Service } from "typedi";

import config from "../../config";
import ConsoleWriter from "./consoleWriter";
import { OUTPUT_WRITER } from "./constants";
import FileWriter from "./fileWriter";
import RestWriter from "./restWriter";
import S3Writer from "./s3Writer";
import type { IOptimisticOutputWriter } from "./types";

function createOutputWriter(): IOptimisticOutputWriter {
  if (config.outS3Bucket) {
    return new S3Writer();
  } else if (config.outEndpoint) {
    return new RestWriter();
  } else if (config.outDir) {
    return new FileWriter();
  }
  return new ConsoleWriter();
}

@Service({ factory: createOutputWriter, id: OUTPUT_WRITER })
export class OutputWriter implements IOptimisticOutputWriter {
  write: (prefix: number | string, result: unknown) => Promise<void>;
}
