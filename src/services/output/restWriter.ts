import axios from "axios";

import config from "../../config";
import type { IOptimisticOutputWriter } from "./types";

export default class RestWriter implements IOptimisticOutputWriter {
  public async write(prefix: number | string, result: unknown): Promise<void> {
    if (!config.outEndpoint) {
      throw new Error("rest endpoint is not set");
    }
    await axios.post(config.outEndpoint, result, {
      headers: {
        ...JSON.parse(config.outHeaders),
        "content-type": "application/json",
      },
    });
  }
}
