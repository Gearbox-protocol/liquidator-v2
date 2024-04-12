import Container, { Service } from "typedi";

import type { ConfigSchema } from "../../config";
import { CONFIG } from "../../config";
import ConsoleWriter from "./consoleWriter";
import { OUTPUT_WRITER } from "./constants";
import FileWriter from "./fileWriter";
import RestWriter from "./restWriter";
import S3Writer from "./s3Writer";
import type { IOptimisticOutputWriter } from "./types";

function createOutputWriter(): IOptimisticOutputWriter {
  const config = Container.get(CONFIG) as ConfigSchema;
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
