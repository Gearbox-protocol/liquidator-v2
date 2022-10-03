import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { join } from "node:path";

import config from "../../config";
import { OptimisticResult } from "../../core/optimistic";
import { IOptimisticOutputWriter } from "./types";

export default class S3Writer implements IOptimisticOutputWriter {
  public async write(
    startBlock: number,
    result: OptimisticResult[],
  ): Promise<void> {
    const key = join(
      config.outS3Prefix ?? "",
      `${startBlock}-${config.outSuffix.replaceAll("-", "")}.json`,
    );
    const client = new S3Client({});
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: config.outS3Bucket,
          Key: key,
          ContentType: "application/json",
          Body: JSON.stringify({ startBlock, result }),
        }),
      );
    } catch (e) {
      console.error(e);
    }
  }
}
