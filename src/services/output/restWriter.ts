import axios from "axios";

import config from "../../config";
import { OptimisticResult } from "../../core/optimistic";
import { IOptimisticOutputWriter } from "./types";

export default class RestWriter implements IOptimisticOutputWriter {
  public async write(
    startBlock: number,
    result: OptimisticResult[],
  ): Promise<void> {
    if (!config.outEndpoint) {
      throw new Error("rest endpoint is not set");
    }
    await axios.post(
      config.outEndpoint,
      { startBlock, result },
      {
        headers: {
          ...JSON.parse(config.outHeaders),
          "content-type": "application/json",
        },
      },
    );
  }
}
