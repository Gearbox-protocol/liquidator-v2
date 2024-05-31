import axios from "axios";

import BaseWriter from "./BaseWriter.js";
import type { IOptimisticOutputWriter } from "./types.js";

export default class RestWriter
  extends BaseWriter
  implements IOptimisticOutputWriter
{
  public async write(prefix: number | string, result: unknown): Promise<void> {
    if (!this.config.outEndpoint) {
      throw new Error("rest endpoint is not set");
    }
    await axios.post(this.config.outEndpoint, result, {
      headers: {
        ...JSON.parse(this.config.outHeaders),
        "content-type": "application/json",
      },
    });
  }
}
