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
    if (this.config.outS3Bucket) {
      return new S3Writer(this.config);
    } else if (this.config.outEndpoint) {
      return new RestWriter(this.config);
    } else if (this.config.outDir) {
      return new FileWriter(this.config);
    }
    return new ConsoleWriter();
  }
}
