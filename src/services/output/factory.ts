import type { IFactory } from "di-at-home";

import type { Config } from "../../config/index.js";
import { DI } from "../../di.js";
import ConsoleWriter from "./consoleWriter.js";
import FileWriter from "./fileWriter.js";
import RestWriter from "./restWriter.js";
import S3Writer from "./s3Writer.js";
import type { IOptimisticOutputWriter } from "./types.js";

@DI.Factory(DI.Output)
export class OutputWriterFactory
  implements IFactory<IOptimisticOutputWriter, []>
{
  @DI.Inject(DI.Config)
  config!: Config;

  produce(): IOptimisticOutputWriter {
    if (this.config.outS3Bucket && this.config.outFileName) {
      return new S3Writer();
    } else if (this.config.outEndpoint) {
      return new RestWriter();
    } else if (this.config.outDir && this.config.outFileName) {
      return new FileWriter();
    }
    return new ConsoleWriter();
  }
}
