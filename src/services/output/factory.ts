import { Container, Service } from "typedi";

import type { Config } from "../../config/index.js";
import { CONFIG } from "../../config/index.js";
import ConsoleWriter from "./consoleWriter.js";
import { OUTPUT_WRITER } from "./constants.js";
import FileWriter from "./fileWriter.js";
import RestWriter from "./restWriter.js";
import S3Writer from "./s3Writer.js";
import type { IOptimisticOutputWriter } from "./types.js";

function createOutputWriter(): IOptimisticOutputWriter {
  const config = Container.get(CONFIG) as Config;
  if (config.outS3Bucket) {
    return new S3Writer(config);
  } else if (config.outEndpoint) {
    return new RestWriter(config);
  } else if (config.outDir) {
    return new FileWriter(config);
  }
  return new ConsoleWriter();
}

@Service({ factory: createOutputWriter, id: OUTPUT_WRITER })
export class OutputWriter implements IOptimisticOutputWriter {
  write: (prefix: number | string, result: unknown) => Promise<void>;
}
