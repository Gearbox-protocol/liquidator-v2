import { json_stringify } from "@gearbox-protocol/sdk";

import type { Config } from "../../config/index.js";
import { DI } from "../../di.js";
import { type ILogger, Logger } from "../../log/index.js";
import type { OptimisticResults } from "../liquidate/index.js";

export default class BaseWriter {
  @Logger("OutputWriter")
  log!: ILogger;

  @DI.Inject(DI.Config)
  config!: Config;

  @DI.Inject(DI.OptimisticResults)
  optimistic!: OptimisticResults;

  protected get filename(): string {
    const fname = this.config.outFileName;
    if (!fname) {
      throw new Error(`out file name not specified in config`);
    }
    return fname.endsWith(".json") ? fname : `${fname}.json`;
  }

  protected get content(): string {
    return json_stringify({
      result: this.optimistic.get(),
      startBlock: this.config.startBlock,
    });
  }
}
