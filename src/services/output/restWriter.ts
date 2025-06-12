import axios from "axios";

import BaseWriter from "./BaseWriter.js";
import type { IOptimisticOutputWriter } from "./types.js";

export default class RestWriter
  extends BaseWriter
  implements IOptimisticOutputWriter
{
  public async write(): Promise<void> {
    if (!this.config.outEndpoint) {
      throw new Error("rest endpoint is not set");
    }
    await axios.post(this.config.outEndpoint, this.content, {
      headers: {
        ...JSON.parse(this.config.outHeaders.value),
        "content-type": "application/json",
      },
    });
  }
}
